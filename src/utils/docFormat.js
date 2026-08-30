// Полные названия месяцев в родительном падеже — для дат в документах
// ("«06» августа 2026 г.")
const MONTHS_GENITIVE = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

// Названия месяцев для имён папок ("08_Август")
const RU_MONTHS_FOLDER = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function fmtRub(n) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Сумма прописью с рублями/копейками словами ("Сорок три тысячи ... рублей ...копеек")
function numToWords(n) {
  const r2 = Math.floor(n);
  const k = Math.round((n - r2) * 100);
  const ones   = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const ones_f = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
  const teens  = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens   = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  function chunk(num, female) {
    let s = ''; const h = Math.floor(num/100); num %= 100;
    s += hundreds[h] ? hundreds[h]+' ' : '';
    if (num >= 10 && num < 20) { s += teens[num-10]+' '; }
    else {
      s += tens[Math.floor(num/10)] ? tens[Math.floor(num/10)]+' ' : '';
      num %= 10;
      s += (female ? ones_f[num] : ones[num]) ? (female ? ones_f[num] : ones[num])+' ' : '';
    }
    return s;
  }
  function rubWord(n) { const n2=n%100,n1=n%10; if(n2>=11&&n2<=19) return 'рублей'; if(n1===1) return 'рубль'; if(n1>=2&&n1<=4) return 'рубля'; return 'рублей'; }
  function kopWord(n) { const n2=n%100,n1=n%10; if(n2>=11&&n2<=19) return 'копеек'; if(n1===1) return 'копейка'; if(n1>=2&&n1<=4) return 'копейки'; return 'копеек'; }
  let result = '';
  const millions = Math.floor(r2/1000000), thousands = Math.floor((r2%1000000)/1000), rubs = r2%1000;
  if (millions) { result += chunk(millions,false); const m2=millions%100,m1=millions%10; if(m2>=11&&m2<=19) result+='миллионов '; else if(m1===1) result+='миллион '; else if(m1>=2&&m1<=4) result+='миллиона '; else result+='миллионов '; }
  if (thousands) { result += chunk(thousands,true); const t2=thousands%100,t1=thousands%10; if(t2>=11&&t2<=19) result+='тысяч '; else if(t1===1) result+='тысяча '; else if(t1>=2&&t1<=4) result+='тысячи '; else result+='тысяч '; }
  if (rubs || !result) result += chunk(rubs,false);
  result = result.trim(); if (!result) result = 'ноль';
  result = result.charAt(0).toUpperCase()+result.slice(1);
  result += ' '+rubWord(r2);
  let kopStr = k === 0 ? 'ноль' : (chunk(k,true).trim()||'ноль');
  kopStr = kopStr.charAt(0).toUpperCase()+kopStr.slice(1);
  result += ' '+kopStr+' '+kopWord(k);
  return result;
}

module.exports = { MONTHS_GENITIVE, RU_MONTHS_FOLDER, fmtRub, numToWords };
