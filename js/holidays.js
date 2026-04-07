// =============================================
//  Festivita' italiane — blocco calendario pubblico
// =============================================
function getItalianHolidays(year) {
    // Festivita' fisse
    const fixed = [
        [0, 1],   // 1 gennaio — Capodanno
        [0, 6],   // 6 gennaio — Epifania
        [3, 25],  // 25 aprile — Liberazione
        [4, 1],   // 1 maggio — Festa del Lavoro
        [5, 2],   // 2 giugno — Festa della Repubblica
        [7, 15],  // 15 agosto — Ferragosto
        [10, 1],  // 1 novembre — Ognissanti
        [11, 8],  // 8 dicembre — Immacolata
        [11, 25], // 25 dicembre — Natale
        [11, 26], // 26 dicembre — Santo Stefano
        [11, 31], // 31 dicembre — San Silvestro
    ];

    // Pasqua (algoritmo di Gauss/Anonymous Gregorian)
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easter = new Date(year, month, day);
    const easterMonday = new Date(year, month, day + 1);

    // Set di stringhe 'YYYY-MM-DD' per lookup veloce
    const holidays = new Set();
    fixed.forEach(([m, d]) => {
        holidays.add(`${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    });
    holidays.add(formatHolidayDate(easter));
    holidays.add(formatHolidayDate(easterMonday));

    return holidays;
}

function formatHolidayDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Cache per anno
const _holidayCache = {};
function isItalianHoliday(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    if (!_holidayCache[year]) _holidayCache[year] = getItalianHolidays(year);
    return _holidayCache[year].has(dateStr);
}
