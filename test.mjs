// Çalıştır: node test.mjs
import assert from 'node:assert/strict';
import { parseTL, kalan, durum, rapor, gunFark, taksitler, taksitPlani, siradakiVade, geciken, tlBicimle, hatirlatmalar, bildirimMetni } from './core.js';

assert.equal(parseTL('1.250,50'), 125050);
assert.equal(parseTL('1250.5'), 125050);
assert.equal(parseTL('1.250'), 125000);
assert.equal(parseTL('₺ 300'), 30000);
assert.equal(parseTL('0,1'), 10);
assert.ok(Number.isNaN(parseTL('abc')));
assert.ok(Number.isNaN(parseTL('-5')));
assert.ok(Number.isNaN(parseTL('')));

const a = (alinacak, vade, ...odemeler) => ({ kisi: 'Ali', verilen: alinacak, alinacak, vade, tahsilatlar: odemeler.map(tutar => ({ tutar, hesapId: 'z' })) });
const bugun = '2026-11-23';
const gecmis = a(1000, '2026-11-01', 300);
const gelecek = a(500, '2026-12-01');
const kapali = a(200, '2026-10-01', 150, 100); // fazla ödeme
const vadesiz = a(400, '');

assert.equal(kalan(gecmis), 700);
assert.equal(kalan(kapali), 0);
assert.equal(durum(gecmis, bugun), 'gecmis');
assert.equal(durum(gelecek, bugun), 'acik');
assert.equal(durum(kapali, bugun), 'kapandi');
assert.equal(durum(a(100, bugun), bugun), 'acik'); // vade günü henüz gecikmiş sayılmaz

const r = rapor([gecmis, gelecek, kapali, vadesiz], bugun);
assert.equal(r.toplam, 2100);
assert.equal(r.alinan, 550);
assert.equal(r.kalan, 1600);
assert.deepEqual(r.gecmis, [gecmis]);
assert.deepEqual(r.gelecek, [gelecek]);
assert.equal(gunFark('2026-12-01', bugun), 8);
assert.equal(r.gecikmis, 700);
assert.equal(r.gelecekTutar, 500);
assert.deepEqual(r.kisiler, [{ ad: 'Ali', adet: 4, toplam: 2100, kalan: 1600 }]);
assert.deepEqual(r.hesaplar, [{ hesapId: 'z', tutar: 550 }]);

// Taksit: 1000 TL, 3 taksit, ilk vade 31 Ekim → 31 Eki, 30 Kas, 31 Ara; kuruş farkı sonda
const t = { ...a(1000, '2026-10-31', 400), alinacak: 100000, tahsilatlar: [{ tutar: 40000 }], taksit: 3 };
assert.deepEqual(taksitler(t).map(x => x.vade), ['2026-10-31', '2026-11-30', '2026-12-31']);
assert.deepEqual(taksitler(t).map(x => x.tutar), [33333, 33333, 33334]);
assert.deepEqual(taksitPlani(t).map(x => x.odenen), [33333, 6667, 0]);
assert.equal(siradakiVade(t), '2026-11-30');
assert.equal(geciken(t, bugun), 0);              // 2. taksit henüz gelmedi
assert.equal(durum(t, '2026-12-01'), 'gecmis');
assert.equal(geciken(t, '2026-12-01'), 26666);   // 2. taksitin ödenmeyen kısmı
const rt = rapor([t], '2026-12-01');
assert.equal(rt.gecikmis + rt.gelecekTutar, kalan(t));

// Yazarken biçimlendirme
assert.equal(tlBicimle('1000000'), '1.000.000');
assert.equal(tlBicimle('1.0000'), '10.000');
assert.equal(tlBicimle('1234,567'), '1.234,56');
assert.equal(tlBicimle('0012'), '12');
assert.equal(tlBicimle('abc'), '');
for (const s of ['1000000', '1234,5', '999']) assert.equal(parseTL(tlBicimle(s)), parseTL(s));

// Hatırlatmalar: gecikmiş + 3 gün içinde gelecek; uzaktaki ve kapanan yok
const h = hatirlatmalar([gecmis, gelecek, kapali, vadesiz, a(300, '2026-11-25')], 3, bugun);
assert.deepEqual(h.map(x => [x.vade, x.tutar, x.gecikti]), [['2026-11-01', 700, true], ['2026-11-25', 300, false]]);
assert.equal(bildirimMetni([gecmis], 3, bugun).baslik, '1 ödeme gecikti');
assert.equal(bildirimMetni([gelecek], 3, bugun), null);

console.log('Tüm testler geçti');
