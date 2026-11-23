// Saf hesaplama fonksiyonları. Tutarlar her yerde kuruş (tam sayı) olarak tutulur.

// "1.250,50" / "1250.5" / "1.250" / "₺ 300" → kuruş. Geçersizse NaN.
export function parseTL(s) {
  s = String(s ?? '').trim().replace(/[₺\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

// Yazarken biçimlendirme: "1000000,5" → "1.000.000,5". Noktalar binlik ayırıcıdır, ondalık virgüldür.
export function tlBicimle(s) {
  const [tam, ...ond] = String(s).replace(/[^\d,]/g, '').split(',');
  const y = tam.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return ond.length ? `${y},${ond.join('').slice(0, 2)}` : y;
}

export const fmtTL =k => (k / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
export const tlYaz = k => (k / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 });

export const bugun = () => new Date().toLocaleDateString('sv'); // yerel YYYY-MM-DD
export const gunFark = (vade, today = bugun()) => Math.round((Date.parse(vade) - Date.parse(today)) / 864e5);

export const tahsil = a => a.tahsilatlar.reduce((t, x) => t + x.tutar, 0);
export const kalan = a => Math.max(0, a.alinacak - tahsil(a));

// Ay ekler, ay sonunu taşırmaz (31 Ocak + 1 ay = 28/29 Şubat).
function ayEkle(tarih, n) {
  const [y, m, d] = tarih.split('-').map(Number);
  const son = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, son))).toISOString().slice(0, 10);
}

// Vade = ilk taksit; aylık eşit taksit, kuruş farkı son taksitte. Taksitsiz alacak tek taksittir.
export function taksitler(a) {
  if (!a.vade) return [];
  const n = Math.max(1, a.taksit || 1), pay = Math.floor(a.alinacak / n);
  return Array.from({ length: n }, (_, i) => ({ vade: ayEkle(a.vade, i), tutar: i === n - 1 ? a.alinacak - pay * (n - 1) : pay }));
}

// Tahsilatlar taksitlere sırayla sayılır.
export function taksitPlani(a) {
  let kalanOdeme = tahsil(a);
  return taksitler(a).map(x => {
    const odenen = Math.min(x.tutar, Math.max(0, kalanOdeme));
    kalanOdeme -= x.tutar;
    return { ...x, odenen };
  });
}
export const siradakiVade = a => taksitPlani(a).find(x => x.odenen < x.tutar)?.vade || '';
export const geciken = (a, today = bugun()) => taksitPlani(a).reduce((t, x) => t + (x.vade < today ? x.tutar - x.odenen : 0), 0);

export function durum(a, today = bugun()) {
  if (kalan(a) === 0) return 'kapandi';
  if (geciken(a, today) > 0) return 'gecmis';
  return 'acik';
}

// Vadesi geçmiş ya da `gun` gün içinde gelecek açık ödemeler; tutar o vadede ödenmesi gereken kısım.
export function hatirlatmalar(list, gun = 3, today = bugun()) {
  const sinir = new Date(Date.parse(today) + gun * 864e5).toISOString().slice(0, 10);
  return list.filter(a => kalan(a) > 0).map(a => {
    const t = taksitPlani(a).find(x => x.odenen < x.tutar);
    if (!t || t.vade > sinir) return null;
    return { a, vade: t.vade, gecikti: t.vade < today, tutar: t.vade < today ? geciken(a, today) : t.tutar - t.odenen };
  }).filter(Boolean).sort((x, y) => (x.vade < y.vade ? -1 : 1));
}

export function bildirimMetni(list, gun, today = bugun()) {
  const l = hatirlatmalar(list, gun, today);
  if (!l.length) return null;
  const gec = l.filter(x => x.gecikti).length, yak = l.length - gec;
  const baslik = [gec && `${gec} ödeme gecikti`, yak && `${yak} ödeme yaklaşıyor`].filter(Boolean).join(', ');
  const ne = x => (x.gecikti ? 'gecikti' : x.vade === today ? 'bugün' : `${gunFark(x.vade, today)} gün sonra`);
  const govde = l.slice(0, 5).map(x => `${x.a.kisi}: ${fmtTL(x.tutar)} · ${ne(x)}`).join('\n') + (l.length > 5 ? `\n+${l.length - 5} ödeme daha` : '');
  return { baslik, govde };
}

export function rapor(list, today = bugun()) {
  const r = { verilen: 0, toplam: 0, alinan: 0, kalan: 0, gecikmis: 0, gelecekTutar: 0, gecmis: [], gelecek: [], kisiler: [], hesaplar: [] };
  const kisi = new Map(), hesap = new Map();
  for (const a of list) {
    const k = kalan(a), g = geciken(a, today);
    r.verilen += a.verilen;
    r.toplam += a.alinacak;
    r.alinan += tahsil(a);
    r.kalan += k;
    r.gecikmis += g;
    if (g > 0) r.gecmis.push(a);
    if (k - g > 0 && a.vade) { r.gelecek.push(a); r.gelecekTutar += k - g; }
    const anahtar = a.kisi.trim().toLocaleLowerCase('tr');
    const p = kisi.get(anahtar) || { ad: a.kisi.trim(), adet: 0, toplam: 0, kalan: 0 };
    p.adet++; p.toplam += a.alinacak; p.kalan += k;
    kisi.set(anahtar, p);
    for (const t of a.tahsilatlar) hesap.set(t.hesapId, (hesap.get(t.hesapId) || 0) + t.tutar);
  }
  const vadeSira = (x, y) => (siradakiVade(x) < siradakiVade(y) ? -1 : 1);
  r.gecmis.sort(vadeSira);
  r.gelecek.sort(vadeSira);
  r.kisiler = [...kisi.values()].sort((x, y) => y.kalan - x.kalan);
  r.hesaplar = [...hesap].map(([hesapId, tutar]) => ({ hesapId, tutar })).sort((x, y) => y.tutar - x.tutar);
  return r;
}
