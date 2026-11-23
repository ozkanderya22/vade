import { parseTL, fmtTL, tlYaz, tahsil, kalan, durum, rapor, bugun, gunFark, taksitPlani, siradakiVade, geciken, tlBicimle } from './core.js';

// ---- Depolama: tüm veri tek IndexedDB kaydında, yalnızca bu cihazda ----
// shortcut: her kayıtta tüm veri (fotoğraflar dahil) yeniden yazılır; yüzlerce fotoğrafta yavaşlarsa fotoğrafları ayrı kayda taşı.
const db = await new Promise((ok, err) => {
  const r = indexedDB.open('vade', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => err(r.error);
});
const oku = () => new Promise((ok, err) => {
  const q = db.transaction('kv').objectStore('kv').get('state');
  q.onsuccess = () => ok(q.result);
  q.onerror = () => err(q.error);
});
async function kaydet() {
  try {
    await new Promise((ok, err) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(S, 'state');
      t.oncomplete = ok;
      t.onerror = () => err(t.error);
    });
  } catch (e) {
    alert('Kaydedilemedi: ' + e.message);
  }
}

let S = (await oku()) || { alacaklar: [], hesaplar: [] };
S.notlar ||= []; // notlar sonradan eklendi; eski kayıtlarda yok
let ara = '', filtre = 'acik';
navigator.storage?.persist?.(); // tarayıcının veriyi kendiliğinden silmesini engeller
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { type: 'module' });
  // Arka plan kontrolü desteklenmese de uygulama açılınca günün hatırlatması yapılır.
  if (S.bildirim) navigator.serviceWorker.ready.then(r => r.active?.postMessage('hatirlat'));
}
let arkaPlan = false; // telefon uygulama kapalıyken de kontrol edebiliyor mu
navigator.serviceWorker?.ready.then(async r => { arkaPlan = !!(await r.periodicSync?.getTags())?.includes('vade-hatirlat'); });

// ---- Yardımcılar ----
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yeniId = () => crypto.randomUUID();
const bul = i => S.alacaklar.find(a => a.id === i);
const SEKIL = { kart: 'Kredi kartı', hesap: 'Hesaptan gönderme', elden: 'Elden' };
const tarihYaz = d => new Date(d + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const hesapAd = i => { const h = S.hesaplar.find(h => h.id === i); return h ? `${h.banka} · ${h.ad}` : i ? 'Silinmiş hesap' : 'Belirtilmedi'; };
const bos = t => `<p class="bos">${t}</p>`;
const radio = (ad, v, etiket, sec) => `<label><input type="radio" name="${ad}" value="${v}" ${v === sec ? 'checked' : ''}><span>${etiket}</span></label>`;
const hesapOps = (tur, sec) => S.hesaplar.filter(h => h.tur === tur)
  .map(h => `<option value="${h.id}" ${h.id === sec ? 'selected' : ''}>${esc(h.banka)} · ${esc(h.ad)}</option>`).join('')
  + `<option value="__yeni">＋ Yeni ${tur === 'kart' ? 'kart' : 'hesap'} ekle…</option>`;

function rozet(a) {
  const d = durum(a);
  if (d === 'kapandi') return '<span class="rozet ok">Kapandı</span>';
  if (!a.vade) return '<span class="rozet">Vadesiz</span>';
  const g = gunFark(siradakiVade(a));
  if (d === 'gecmis') return `<span class="rozet kirmizi">${-g} gün gecikti</span>`;
  if (g === 0) return '<span class="rozet turuncu">Vadesi bugün</span>';
  return `<span class="rozet ${g <= 7 ? 'turuncu' : ''}">${g} gün kaldı</span>`;
}
const oran = a => (a.alinacak ? Math.min(100, (tahsil(a) / a.alinacak) * 100) : 100);
const kart = (a, tutar = kalan(a), etiket = rozet(a)) => `<a class="kart" href="#/a/${a.id}">
  <div class="ust"><b>${esc(a.kisi)}</b><span class="tutar">${fmtTL(tutar)}</span></div>
  <div class="bar"><i style="width:${oran(a)}%"></i></div>
  <div class="alt"><span>${fmtTL(a.alinacak)} alacaktan kalan${a.taksit > 1 ? ` · ${a.taksit} taksit` : ''}</span>${etiket}</div></a>`;

// ---- Diyalog (form) ----
function formAc(baslik, govde, { kaydet = 'Kaydet', iptal = 'Vazgeç', tehlike = false, dogrula, hazirla } = {}) {
  return new Promise(ok => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog"><h2>${baslik}</h2>${govde}<p class="hata" hidden></p>
      <div class="dugmeler"><button value="iptal" formnovalidate>${iptal}</button><button value="ok" class="${tehlike ? 'tehlike' : 'birincil'}">${kaydet}</button></div></form>`;
    document.body.append(d);
    const f = d.querySelector('form');
    hazirla?.(f);
    const bitir = sonuc => { ok(sonuc); d.close(); d.remove(); };
    // Sonuç submit anında verilir: bazı tarayıcılarda dialog 'close' olayı güvenilir gelmiyor.
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (e.submitter?.value !== 'ok') return bitir(null);
      const hata = dogrula?.(f);
      if (hata) { const p = f.querySelector('.hata'); p.textContent = hata; p.hidden = false; return; }
      bitir(f);
    });
    d.addEventListener('cancel', () => bitir(null)); // geri tuşu / Esc
    d.showModal();
  });
}

async function hesapFormu(h = { tur: 'hesap' }) {
  const f = await formAc(h.id ? 'Hesabı düzenle' : 'Hesap / kart ekle', `
    <div class="seg">${radio('tur', 'hesap', 'Banka hesabı', h.tur)}${radio('tur', 'kart', 'Kredi kartı', h.tur)}</div>
    <label>Banka<input name="banka" required value="${esc(h.banka)}" placeholder="ör. Ziraat Bankası"></label>
    <label>Hesap / kart adı<input name="ad" required value="${esc(h.ad)}" placeholder="ör. Vadesiz TL, Bonus Kart"></label>`);
  if (!f) return null;
  const e = f.elements;
  const y = { ...h, id: h.id || yeniId(), tur: e.tur.value, banka: e.banka.value.trim(), ad: e.ad.value.trim() };
  S.hesaplar = h.id ? S.hesaplar.map(x => (x.id === h.id ? y : x)) : [...S.hesaplar, y];
  await kaydet();
  return y;
}

async function alacakFormu(a) {
  const y = a || { sekil: 'kart', tarih: bugun() };
  const f = await formAc(a ? 'Alacağı düzenle' : 'Yeni alacak', `
    <label>Kime verildi<input name="kisi" required value="${esc(y.kisi)}" placeholder="Ad soyad / firma" autocomplete="off"></label>
    <label>Verilen meblağ (₺)<input name="verilen" required class="tl" inputmode="decimal" value="${a ? tlYaz(a.verilen) : ''}" placeholder="0,00"></label>
    <fieldset><legend>Verilme şekli</legend><div class="seg">${radio('sekil', 'kart', 'Kredi kartı', y.sekil)}${radio('sekil', 'hesap', 'Hesaptan', y.sekil)}${radio('sekil', 'elden', 'Elden', y.sekil)}</div></fieldset>
    <label class="kaynak">Verilen yer<select name="kaynak"></select></label>
    <label>Alınacak meblağ (₺)<input name="alinacak" class="tl" inputmode="decimal" value="${a ? tlYaz(a.alinacak) : ''}" placeholder="Boş bırakılırsa verilen meblağ"></label>
    <div class="iki"><label>Veriliş tarihi<input type="date" name="tarih" required value="${y.tarih}"></label>
    <label>Vade (ilk taksit)<input type="date" name="vade" value="${y.vade || ''}"></label></div>
    <label>Taksit sayısı<input type="number" name="taksit" min="1" max="120" inputmode="numeric" value="${y.taksit || 1}"><small>1'den fazlaysa vade tarihinden başlayarak aylık eşit taksit</small></label>
    <label>Kısa açıklama<textarea name="aciklama" rows="2">${esc(y.aciklama)}</textarea></label>`, {
    hazirla: f => {
      const e = f.elements;
      const doldur = sec => {
        const t = e.sekil.value;
        f.querySelector('.kaynak').hidden = t === 'elden';
        if (t !== 'elden') e.kaynak.innerHTML = '<option value="">Seçin…</option>' + hesapOps(t, sec);
      };
      doldur(y.kaynakId);
      f.addEventListener('change', async ev => {
        if (ev.target.name === 'sekil') doldur();
        if (ev.target.value === '__yeni') doldur((await hesapFormu({ tur: e.sekil.value }))?.id);
      });
    },
    dogrula: f => {
      const e = f.elements;
      if (!(parseTL(e.verilen.value) > 0)) return 'Verilen meblağ geçersiz.';
      if (e.alinacak.value && !(parseTL(e.alinacak.value) > 0)) return 'Alınacak meblağ geçersiz.';
      const n = Number(e.taksit.value || 1);
      if (!Number.isInteger(n) || n < 1 || n > 120) return 'Taksit sayısı 1 ile 120 arasında olmalı.';
      if (n > 1 && !e.vade.value) return 'Taksitli alacak için ilk taksit (vade) tarihi gerekli.';
    },
  });
  if (!f) return;
  const e = f.elements, verilen = parseTL(e.verilen.value);
  const n = {
    ...(a || { id: yeniId(), belgeler: [], tahsilatlar: [] }),
    kisi: e.kisi.value.trim(), verilen, sekil: e.sekil.value,
    kaynakId: e.sekil.value === 'elden' ? '' : e.kaynak.value,
    alinacak: e.alinacak.value ? parseTL(e.alinacak.value) : verilen,
    tarih: e.tarih.value, vade: e.vade.value, taksit: Number(e.taksit.value || 1), aciklama: e.aciklama.value.trim(),
  };
  S.alacaklar = a ? S.alacaklar.map(x => (x.id === a.id ? n : x)) : [n, ...S.alacaklar];
  await kaydet();
  location.hash = '#/a/' + n.id;
  render();
}

async function tahsilatFormu(a) {
  const f = await formAc('Tahsilat ekle', `
    <p class="not">Kalan: <b>${fmtTL(kalan(a))}</b></p>
    <label>Alınan tutar (₺)<input name="tutar" required class="tl" inputmode="decimal" value="${kalan(a) ? tlYaz(kalan(a)) : ''}"></label>
    <label>Tarih<input type="date" name="tarih" required value="${bugun()}"></label>
    <label>Paranın yattığı yer<select name="hesap"></select></label>
    <label>Not<input name="not" placeholder="İsteğe bağlı"></label>`, {
    kaydet: 'Tahsilatı kaydet',
    hazirla: f => {
      const doldur = sec => (f.elements.hesap.innerHTML = '<option value="">Elden / nakit</option>' + hesapOps('hesap', sec));
      doldur();
      f.addEventListener('change', async ev => { if (ev.target.value === '__yeni') doldur((await hesapFormu({ tur: 'hesap' }))?.id); });
    },
    dogrula: f => (parseTL(f.elements.tutar.value) > 0 ? '' : 'Tutar geçersiz.'),
  });
  if (!f) return;
  const e = f.elements;
  a.tahsilatlar.push({ id: yeniId(), tutar: parseTL(e.tutar.value), tarih: e.tarih.value, hesapId: e.hesap.value, not: e.not.value.trim() });
  await kaydet();
  render();
}

// Telefon fotoğraflarını ~1600 piksele küçültüp JPEG olarak saklar (çek okunur kalır, depo şişmez).
async function kucult(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// ---- Sayfalar ----
function kartlar() {
  const q = ara.toLocaleLowerCase('tr');
  const sira = a => (durum(a) === 'kapandi' ? '2' : a.vade ? '0' + siradakiVade(a) : '1');
  const l = S.alacaklar
    .filter(a => (filtre === 'hepsi' || (filtre === 'acik' ? durum(a) !== 'kapandi' : durum(a) === filtre))
      && `${a.kisi} ${a.aciklama}`.toLocaleLowerCase('tr').includes(q))
    .sort((x, y) => (sira(x) < sira(y) ? -1 : 1));
  return l.map(a => kart(a)).join('') || bos(S.alacaklar.length ? 'Eşleşen alacak yok.' : 'Henüz alacak yok.<br>Sağ alttaki <b>+</b> ile ilk alacağınızı ekleyin.');
}

function listeHTML() {
  const r = rapor(S.alacaklar);
  const chip = (v, t) => `<button class="${filtre === v ? 'secili' : ''}" data-act="filtre" data-id="${v}">${t}</button>`;
  return `<h1>Alacaklar</h1>
  <div class="ozet"><small>Alınması gereken</small><strong>${fmtTL(r.kalan)}</strong>
    <span>${r.gecmis.length ? `⚠ ${r.gecmis.length} alacağın vadesi geçti` : 'Vadesi geçen alacak yok'}</span></div>
  <input class="ara" type="search" placeholder="Kişi veya açıklama ara…" value="${esc(ara)}">
  <div class="chips">${chip('acik', 'Açık')}${chip('gecmis', 'Gecikmiş')}${chip('kapandi', 'Kapanan')}${chip('hepsi', 'Tümü')}</div>
  <div id="kartlar">${kartlar()}</div>`;
}

function detayHTML(i) {
  const a = bul(i);
  if (!a) return bos('Alacak bulunamadı. <a href="#/">Listeye dön</a>');
  const satir = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const tah = [...a.tahsilatlar].sort((x, y) => (x.tarih < y.tarih ? 1 : -1)).map(t => `<div class="satir">
      <div><b>${fmtTL(t.tutar)}</b><small>${tarihYaz(t.tarih)} · ${t.hesapId ? esc(hesapAd(t.hesapId)) : 'Elden / nakit'}${t.not ? ' · ' + esc(t.not) : ''}</small></div>
      <button class="kucuk" data-act="tahsilatSil" data-id="${t.id}" data-a="${a.id}" aria-label="Tahsilatı sil">✕</button></div>`).join('');
  const belgeler = a.belgeler.map(b => `<button data-act="belge" data-id="${b.id}" data-a="${a.id}"><img src="${b.foto}" alt="${b.tur === 'cek' ? 'Çek' : 'Senet'} fotoğrafı"><span>${b.tur === 'cek' ? 'Çek' : 'Senet'}</span></button>`).join('');
  return `<div class="bas"><a href="#/" class="geri" aria-label="Geri">‹</a><h1>${esc(a.kisi)}</h1><button class="kucuk" data-act="duzenle" data-id="${a.id}">Düzenle</button></div>
  <div class="ozet"><small>Kalan</small><strong>${fmtTL(kalan(a))}</strong>
    <div class="bar"><i style="width:${oran(a)}%"></i></div>
    <span class="ust"><span>${fmtTL(tahsil(a))} alındı / ${fmtTL(a.alinacak)}</span>${rozet(a)}</span></div>
  <button class="birincil genis" data-act="tahsilat" data-id="${a.id}">＋ Tahsilat ekle</button>
  <h2>Bilgiler</h2><dl class="kutu">
    ${satir('Verilen meblağ', fmtTL(a.verilen))}
    ${satir('Verilme şekli', SEKIL[a.sekil])}
    ${a.sekil !== 'elden' ? satir('Verilen yer', esc(hesapAd(a.kaynakId))) : ''}
    ${satir('Alınacak meblağ', fmtTL(a.alinacak))}
    ${a.alinacak !== a.verilen ? satir('Fark', fmtTL(a.alinacak - a.verilen)) : ''}
    ${satir('Veriliş tarihi', tarihYaz(a.tarih))}
    ${a.taksit > 1 ? satir('Taksit', `${a.taksit} × aylık`) : satir('Vade tarihi', a.vade ? tarihYaz(a.vade) : '—')}
    ${a.aciklama ? satir('Açıklama', esc(a.aciklama)) : ''}</dl>
  ${a.taksit > 1 ? `<h2>Taksit planı</h2><div class="kutu">${taksitPlani(a).map((x, i) => {
    const d = x.odenen >= x.tutar ? ['ok', 'Ödendi'] : x.vade < bugun() ? ['kirmizi', 'Gecikti'] : x.odenen ? ['turuncu', 'Kısmi'] : ['', 'Bekliyor'];
    return `<div class="satir"><div><b>${fmtTL(x.tutar)}</b><small>${i + 1}. taksit · ${tarihYaz(x.vade)}${x.odenen && x.odenen < x.tutar ? ` · ${fmtTL(x.odenen)} ödendi` : ''}</small></div><span class="rozet ${d[0]}">${d[1]}</span></div>`;
  }).join('')}</div>` : ''}
  <h2>Tahsilatlar <span>${a.tahsilatlar.length} adet</span></h2>
  <div class="kutu">${tah || bos('Henüz tahsilat yok.')}</div>
  <h2>Notlar <span>${kisiNotlari(a.kisi).length} adet</span></h2>
  ${kisiNotlari(a.kisi).map(notSatir).join('')}
  <button class="genis" data-act="notEkle" data-id="${esc(a.kisi)}">＋ Bu kişiye not ekle</button>
  <h2>Çek / Senet</h2>
  ${belgeler ? `<div class="belgeler">${belgeler}</div>` : ''}
  <div class="iki"><label class="btn">📷 Çek ekle<input type="file" accept="image/*" multiple hidden data-belge="cek" data-id="${a.id}"></label>
  <label class="btn">📷 Senet ekle<input type="file" accept="image/*" multiple hidden data-belge="senet" data-id="${a.id}"></label></div>
  <button class="tehlike genis bosluk" data-act="sil" data-id="${a.id}">Alacağı sil</button>`;
}

const notSatir = n => `<div class="not-kart"><div class="ust"><b>${n.kisi ? esc(n.kisi) : 'Genel'}</b>
  <span><button class="kucuk" data-act="notDuzenle" data-id="${n.id}">Düzenle</button> <button class="kucuk tehlike" data-act="notSil" data-id="${n.id}" aria-label="Notu sil">✕</button></span></div>
  <p>${esc(n.metin)}</p><small>${tarihYaz(n.tarih)}</small></div>`;
const kisiNotlari = kisi => S.notlar.filter(n => n.kisi.trim().toLocaleLowerCase('tr') === kisi.trim().toLocaleLowerCase('tr'));

function notlarHTML() {
  const l = [...S.notlar].sort((x, y) => (x.tarih < y.tarih ? 1 : -1));
  return `<h1>Notlar</h1>${l.map(notSatir).join('') || bos('Henüz not yok.<br>Sağ alttaki <b>+</b> ile not ekleyin.')}`;
}

async function notFormu(n = { kisi: '' }) {
  const adlar = [...new Set(S.alacaklar.map(a => a.kisi.trim()))];
  const f = await formAc(n.id ? 'Notu düzenle' : 'Yeni not', `
    <label>Kişi (isteğe bağlı)<input name="kisi" list="kisi-listesi" value="${esc(n.kisi)}" autocomplete="off" placeholder="Boş bırakılırsa genel not">
    <datalist id="kisi-listesi">${adlar.map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>
    <label>Not<textarea name="metin" rows="5" required>${esc(n.metin)}</textarea></label>`);
  if (!f) return;
  const y = { ...n, id: n.id || yeniId(), tarih: n.tarih || bugun(), kisi: f.elements.kisi.value.trim(), metin: f.elements.metin.value.trim() };
  S.notlar = n.id ? S.notlar.map(x => (x.id === n.id ? y : x)) : [y, ...S.notlar];
  await kaydet();
  render();
}

function raporHTML() {
  const r = rapor(S.alacaklar);
  const kpi = (t, v, c = '') => `<div class="${c}"><small>${t}</small><b>${fmtTL(v)}</b></div>`;
  const kisiler = r.kisiler.map(p => `<button class="satir satir-btn" data-act="kisi" data-id="${esc(p.ad)}">
    <div><b>${esc(p.ad)}</b><small>${p.adet} alacak · toplam ${fmtTL(p.toplam)}</small></div><b>${fmtTL(p.kalan)}</b></button>`).join('');
  const hesaplar = r.hesaplar.map(h => `<div class="satir"><div>${h.hesapId ? esc(hesapAd(h.hesapId)) : 'Elden / nakit'}</div><b>${fmtTL(h.tutar)}</b></div>`).join('');
  return `<h1>Raporlar</h1>
  <div class="kpi">${kpi('Toplam alacak', r.toplam)}${kpi('Toplam alınan', r.alinan, 'yesil')}${kpi('Alınması gereken', r.kalan, 'vurgu')}${kpi('Verilen toplam', r.verilen)}</div>
  <h2>Vadesi geçmiş <span class="kirmizi-yazi">${fmtTL(r.gecikmis)}</span></h2>
  ${r.gecmis.map(a => kart(a, geciken(a))).join('') || bos('Vadesi geçmiş alacak yok.')}
  <h2>Vadesi gelecek <span>${fmtTL(r.gelecekTutar)}</span></h2>
  ${r.gelecek.map(a => {
    const g = gunFark(taksitPlani(a).find(x => x.vade >= bugun() && x.odenen < x.tutar).vade);
    return kart(a, kalan(a) - geciken(a), `<span class="rozet ${g <= 7 ? 'turuncu' : ''}">${g ? `${g} gün kaldı` : 'Vadesi bugün'}</span>`);
  }).join('') || bos('Vadesi gelecek alacak yok.')}
  <h2>Kişi bazında <span>kalan</span></h2>
  <div class="kutu">${kisiler || bos('Kayıt yok.')}</div>
  <h2>Hesaplara yatan tahsilatlar</h2>
  <div class="kutu">${hesaplar || bos('Henüz tahsilat yok.')}</div>`;
}

function ayarlarHTML() {
  const h = S.hesaplar.map(h => `<div class="satir"><div><b>${esc(h.banka)} · ${esc(h.ad)}</b><small>${h.tur === 'kart' ? 'Kredi kartı' : 'Banka hesabı'}</small></div>
    <span><button class="kucuk" data-act="hesapDuzenle" data-id="${h.id}">Düzenle</button> <button class="kucuk tehlike" data-act="hesapSil" data-id="${h.id}" aria-label="Sil">✕</button></span></div>`).join('');
  return `<h1>Ayarlar</h1>
  <h2>Banka hesapları ve kartlar</h2>
  <div class="kutu">${h || bos('Henüz hesap / kart yok.')}</div>
  <button class="genis" data-act="hesapEkle">＋ Hesap / kart ekle</button>
  <h2>Bildirimler</h2>
  <div class="kutu metin"><p>${!S.bildirim ? 'Kapalı. Açarsanız vadesi gelen ve geciken ödemeler için günde bir kez bildirim gelir.'
    : arkaPlan ? '🔔 Açık. Telefon günde bir kez, uygulama kapalıyken de kontrol edip bildirim gönderir.'
    : '🔔 Açık. Bu cihaz uygulama kapalıyken kontrol edemiyor; hatırlatma uygulamayı açtığınızda gelir. Ana ekrana eklenmiş uygulamada arka plan kontrolü genelde çalışır.'}</p>
  ${S.bildirim ? `<label>Kaç gün önceden hatırlatılsın<select data-ayar="gun">${[0, 1, 3, 7].map(g => `<option value="${g}" ${S.bildirim.gun === g ? 'selected' : ''}>${g ? `${g} gün önce` : 'Vade günü'}</option>`).join('')}</select></label><p></p>` : ''}</div>
  <div class="iki">${S.bildirim ? '<button data-act="bildirimTest">Deneme bildirimi</button><button class="tehlike" data-act="bildirimKapat">Kapat</button>' : '<button class="birincil" data-act="bildirimAc">🔔 Bildirimleri aç</button>'}</div>
  <h2>Güvenlik</h2>
  <div class="kutu metin"><p>${S.pin ? '🔒 PIN kilidi açık. Uygulama açılırken ve 1 dakikadan uzun arka planda kaldıktan sonra PIN sorulur.' : 'PIN kilidi kapalı.'}</p></div>
  <div class="iki"><button data-act="pinAyarla">${S.pin ? 'PIN değiştir' : 'PIN belirle'}</button>${S.pin ? '<button class="tehlike" data-act="pinKaldir">PIN kaldır</button>' : ''}</div>
  <h2>Yedekleme</h2>
  <div class="kutu metin"><p>Veriler yalnızca bu telefonda saklanır. Telefon değişir ya da tarayıcı verisi silinirse kaybolur; ayda bir yedek alıp güvenli bir yere kaydedin.</p>
  <p>Son yedek: <b>${S.sonYedek ? tarihYaz(S.sonYedek) : 'hiç alınmadı'}</b></p></div>
  <div class="iki"><button data-act="disari">⬇ Yedeği indir</button><label class="btn">⬆ Yedekten yükle<input type="file" accept="application/json,.json" hidden data-iceri></label></div>`;
}

function render() {
  const [, yol, p] = location.hash.split('/');
  $('#main').innerHTML = yol === 'a' ? detayHTML(p) : yol === 'rapor' ? raporHTML() : yol === 'ayarlar' ? ayarlarHTML() : yol === 'notlar' ? notlarHTML() : listeHTML();
  const sekme = ['rapor', 'ayarlar', 'notlar'].includes(yol) ? yol : 'liste';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('aktif', a.dataset.sekme === sekme));
  $('.fab').hidden = !!yol && yol !== 'notlar';
  $('.fab').dataset.act = yol === 'notlar' ? 'notEkle' : 'yeni';
  $('.fab').ariaLabel = yol === 'notlar' ? 'Yeni not' : 'Yeni alacak';
}

// ---- Olaylar ----
const eylem = {
  yeni: () => alacakFormu(),
  duzenle: i => alacakFormu(bul(i)),
  tahsilat: i => tahsilatFormu(bul(i)),
  filtre: i => { filtre = i; render(); },
  kisi: ad => { ara = ad; filtre = 'hepsi'; location.hash = '#/'; },
  async bildirimAc() {
    if (!('Notification' in window) || !navigator.serviceWorker) return alert('Bu tarayıcı bildirim desteklemiyor.');
    if ((await Notification.requestPermission()) !== 'granted') return alert('Bildirim izni verilmedi. Telefonun ayarlarından Vade (ya da Chrome) için bildirimlere izin verin.');
    S.bildirim = { gun: 3 };
    await kaydet();
    const r = await navigator.serviceWorker.ready;
    try {
      await r.periodicSync.register('vade-hatirlat', { minInterval: 12 * 36e5 });
      arkaPlan = true;
    } catch { arkaPlan = false; } // ana ekrana eklenmemişse ya da tarayıcı desteklemiyorsa; ayarlarda yazılı olarak gösterilir
    r.active?.postMessage('hatirlat');
    render();
  },
  async bildirimKapat() {
    delete S.bildirim;
    await kaydet();
    (await navigator.serviceWorker.ready).periodicSync?.unregister('vade-hatirlat');
    arkaPlan = false;
    render();
  },
  async bildirimTest() { (await navigator.serviceWorker.ready).active.postMessage('test'); },
  notEkle: kisi =>notFormu({ kisi: kisi || '' }),
  notDuzenle: i => notFormu(S.notlar.find(n => n.id === i)),
  async notSil(i) {
    if (!confirm('Bu not silinsin mi?')) return;
    S.notlar = S.notlar.filter(n => n.id !== i);
    await kaydet();
    render();
  },
  async pinAyarla() {
    const f = await formAc('PIN belirle', `
      <p class="not">PIN'i unutursanız uygulamaya girilemez. Yedek dosyanız varsa uygulamayı silip yeniden kurarak yedeği yükleyebilirsiniz; bu yüzden önce yedek alın.</p>
      <label>Yeni PIN (4–8 rakam)<input name="p1" type="password" inputmode="numeric" autocomplete="off" required></label>
      <label>Yeni PIN tekrar<input name="p2" type="password" inputmode="numeric" autocomplete="off" required></label>`, {
      dogrula: f => (!/^\d{4,8}$/.test(f.elements.p1.value) ? 'PIN 4–8 rakam olmalı.' : f.elements.p1.value !== f.elements.p2.value ? 'PIN\'ler aynı değil.' : ''),
    });
    if (!f) return;
    S.pin = await pinOzet(f.elements.p1.value);
    await kaydet();
    render();
  },
  async pinKaldir() {
    if (!confirm('PIN kilidi kaldırılsın mı?')) return;
    delete S.pin;
    await kaydet();
    render();
  },
  async sil(i) {
    if (!confirm('Bu alacak, tahsilatları ve fotoğraflarıyla birlikte silinsin mi? Geri alınamaz.')) return;
    S.alacaklar = S.alacaklar.filter(a => a.id !== i);
    await kaydet();
    location.hash = '#/';
  },
  async tahsilatSil(i, b) {
    const a = bul(b.dataset.a);
    if (!confirm('Bu tahsilat silinsin mi?')) return;
    a.tahsilatlar = a.tahsilatlar.filter(t => t.id !== i);
    await kaydet();
    render();
  },
  async belge(i, b) {
    const a = bul(b.dataset.a), x = a.belgeler.find(x => x.id === i);
    const f = await formAc(x.tur === 'cek' ? 'Çek' : 'Senet', `<img class="tam" src="${x.foto}" alt="">`, { kaydet: 'Sil', iptal: 'Kapat', tehlike: true });
    if (!f || !confirm('Fotoğraf silinsin mi?')) return;
    a.belgeler = a.belgeler.filter(y => y.id !== i);
    await kaydet();
    render();
  },
  async hesapEkle() { await hesapFormu(); render(); },
  async hesapDuzenle(i) { await hesapFormu(S.hesaplar.find(h => h.id === i)); render(); },
  async hesapSil(i) {
    const n = S.alacaklar.filter(a => a.kaynakId === i || a.tahsilatlar.some(t => t.hesapId === i)).length;
    if (n) return alert(`Bu hesap ${n} alacakta kullanılıyor, silinemez. Adını düzenleyebilirsiniz.`);
    if (!confirm('Hesap / kart silinsin mi?')) return;
    S.hesaplar = S.hesaplar.filter(h => h.id !== i);
    await kaydet();
    render();
  },
  async disari() {
    S.sonYedek = bugun();
    await kaydet();
    const u = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: u, download: `vade-yedek-${bugun()}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
    render();
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) { e.preventDefault(); eylem[b.dataset.act](b.dataset.id, b); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList.contains('ara')) { ara = t.value; $('#kartlar').innerHTML = kartlar(); }
  if (t.classList.contains('tl')) {
    let v = t.value, pos = t.selectionStart;
    // Yazılan/yapıştırılan "." ya da "12.5" ondalıktır; "1.250.000" gibi binlik noktalar olduğu gibi kalır.
    const d = e.data;
    if (d && /^\d*\.\d{0,2}$/.test(d)) v = v.slice(0, pos - d.length) + d.replace('.', ',') + v.slice(pos);
    const once = v.slice(0, pos).replace(/[^\d,]/g, '').length; // imleçten önceki rakam sayısı korunur
    const y = tlBicimle(v);
    let i = 0;
    for (let n = 0; i < y.length && n < once; i++) if (/[\d,]/.test(y[i])) n++;
    t.value = y;
    t.setSelectionRange(i, i);
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.ayar === 'gun') { S.bildirim.gun = Number(t.value); await kaydet(); }
  if (t.dataset.belge) {
    const a = bul(t.dataset.id);
    try {
      for (const file of t.files) a.belgeler.push({ id: yeniId(), tur: t.dataset.belge, foto: await kucult(file) });
      await kaydet();
    } catch (err) { alert('Fotoğraf eklenemedi: ' + err.message); }
    render();
  }
  if ('iceri' in t.dataset && t.files[0]) {
    try {
      const d = JSON.parse(await t.files[0].text());
      if (!Array.isArray(d.alacaklar) || !Array.isArray(d.hesaplar)) throw new Error('Bu dosya geçerli bir Vade yedeği değil.');
      if (!confirm(`${d.alacaklar.length} alacak içeren yedek yüklenecek. Telefondaki mevcut veriler silinip yerine yazılacak. Devam edilsin mi?`)) return;
      S = { notlar: [], ...d, pin: S.pin, bildirim: S.bildirim }; // bu cihazın PIN ve bildirim ayarı geçerli kalır
      if (!S.pin) delete S.pin;
      if (!S.bildirim) delete S.bildirim;
      await kaydet();
      render();
      alert('Yedek yüklendi.');
    } catch (err) { alert('Yüklenemedi: ' + err.message); }
    finally { t.value = ''; }
  }
});
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ---- PIN kilidi ----
// Kilit yalnızca ekran perdesidir; veriler şifrelenmez. Asıl koruma telefonun kendi ekran kilidi.
async function pinOzet(pin) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('vade:' + pin));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function kilitle() {
  if (document.querySelector('.kilit')) return;
  document.querySelectorAll('dialog').forEach(d => d.remove());
  const k = document.createElement('div');
  k.className = 'kilit';
  k.innerHTML = `<form><img src="icon-192.png" alt="" width="72" height="72"><h1>Vade</h1>
    <input type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" aria-label="PIN">
    <p class="hata" hidden>PIN yanlış.</p><button class="birincil">Aç</button></form>`;
  document.body.append(k);
  const inp = k.querySelector('input');
  k.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    if ((await pinOzet(inp.value)) === S.pin) return k.remove();
    k.querySelector('.hata').hidden = false;
    inp.value = '';
  });
  inp.focus();
}
let gizlendi = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) gizlendi = Date.now();
  else if (S.pin && Date.now() - gizlendi > 60000) kilitle();
});
if (S.pin) kilitle();
render();
