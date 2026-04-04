// =============================================
//  COMUNI ITALIANI — dati per autocomplete
//  Formato: [nome, provincia, cap_principale]
// =============================================
window.COMUNI_IT = [
    // Valle d'Aosta
    ["Aosta","AO","11100"],
    // Piemonte
    ["Torino","TO","10100"],["Moncalieri","TO","10024"],["Collegno","TO","10093"],
    ["Settimo Torinese","TO","10036"],["Nichelino","TO","10042"],["Rivoli","TO","10098"],
    ["Novara","NO","28100"],["Alessandria","AL","15100"],["Cuneo","CN","12100"],
    ["Asti","AT","14100"],["Vercelli","VC","13100"],["Biella","BI","13900"],
    ["Verbania","VB","28921"],
    // Liguria
    ["Genova","GE","16100"],["La Spezia","SP","19100"],["Savona","SV","17100"],
    ["Imperia","IM","18100"],
    // Lombardia
    ["Milano","MI","20100"],["Sesto San Giovanni","MI","20099"],["Cinisello Balsamo","MI","20092"],
    ["Rho","MI","20017"],["Cologno Monzese","MI","20093"],["Brescia","BS","25100"],
    ["Bergamo","BG","24100"],["Monza","MB","20900"],["Seregno","MB","20831"],
    ["Como","CO","22100"],["Varese","VA","21100"],["Busto Arsizio","VA","21052"],
    ["Gallarate","VA","21013"],["Pavia","PV","27100"],["Mantova","MN","46100"],
    ["Cremona","CR","26100"],["Lecco","LC","23900"],["Lodi","LO","26900"],
    ["Sondrio","SO","23100"],
    // Trentino-Alto Adige
    ["Trento","TN","38100"],["Bolzano","BZ","39100"],["Merano","BZ","39012"],
    ["Rovereto","TN","38068"],
    // Veneto
    ["Venezia","VE","30100"],["Verona","VR","37100"],["Padova","PD","35100"],
    ["Vicenza","VI","36100"],["Treviso","TV","31100"],["Rovigo","RO","45100"],
    ["Belluno","BL","32100"],["Mestre","VE","30170"],
    // Friuli-Venezia Giulia
    ["Trieste","TS","34100"],["Udine","UD","33100"],["Pordenone","PN","33170"],
    ["Gorizia","GO","34170"],
    // Emilia-Romagna
    ["Bologna","BO","40100"],["Modena","MO","41100"],["Reggio Emilia","RE","42100"],
    ["Parma","PR","43100"],["Ferrara","FE","44100"],["Ravenna","RA","48100"],
    ["Forlì","FC","47121"],["Rimini","RN","47921"],["Cesena","FC","47521"],
    ["Piacenza","PC","29100"],["Imola","BO","40026"],["Faenza","RA","48018"],
    // Toscana
    ["Firenze","FI","50100"],["Prato","PO","59100"],["Livorno","LI","57100"],
    ["Arezzo","AR","52100"],["Siena","SI","53100"],["Pistoia","PT","51100"],
    ["Pisa","PI","56100"],["Lucca","LU","55100"],["Grosseto","GR","58100"],
    ["Massa","MS","54100"],["Carrara","MS","54033"],["Empoli","FI","50053"],
    // Umbria
    ["Perugia","PG","06100"],["Terni","TR","05100"],["Foligno","PG","06034"],
    // Marche
    ["Ancona","AN","60100"],["Pesaro","PU","61121"],["Macerata","MC","62100"],
    ["Ascoli Piceno","AP","63100"],["Fermo","FM","63900"],["Urbino","PU","61029"],
    // Lazio
    ["Roma","RM","00100"],["Viterbo","VT","01100"],["Rieti","RI","02100"],
    ["Latina","LT","04100"],["Frosinone","FR","03100"],["Tivoli","RM","00019"],
    ["Velletri","RM","00049"],["Guidonia Montecelio","RM","00012"],
    ["Civitavecchia","RM","00053"],["Fiumicino","RM","00054"],["Pomezia","RM","00071"],
    // Abruzzo
    ["L'Aquila","AQ","67100"],["Pescara","PE","65100"],["Chieti","CH","66100"],
    ["Teramo","TE","64100"],["Lanciano","CH","66034"],
    // Molise
    ["Campobasso","CB","86100"],["Isernia","IS","86170"],
    // Campania
    ["Napoli","NA","80100"],["Salerno","SA","84100"],["Caserta","CE","81100"],
    ["Benevento","BN","82100"],["Avellino","AV","83100"],
    ["Torre del Greco","NA","80059"],["Giugliano in Campania","NA","80014"],
    ["Pozzuoli","NA","80078"],["Castellammare di Stabia","NA","80053"],
    ["Portici","NA","80055"],["Ercolano","NA","80056"],
    // Puglia
    ["Bari","BA","70100"],["Taranto","TA","74100"],["Foggia","FG","71100"],
    ["Lecce","LE","73100"],["Brindisi","BR","72100"],["Andria","BT","76123"],
    ["Barletta","BT","76121"],["Altamura","BA","70022"],["Molfetta","BA","70056"],
    // Basilicata
    ["Potenza","PZ","85100"],["Matera","MT","75100"],
    // Calabria
    ["Reggio Calabria","RC","89100"],["Cosenza","CS","87100"],["Catanzaro","CZ","88100"],
    ["Vibo Valentia","VV","89900"],["Crotone","KR","88900"],
    // Sicilia
    ["Palermo","PA","90100"],["Catania","CT","95100"],["Messina","ME","98100"],
    ["Siracusa","SR","96100"],["Ragusa","RG","97100"],["Trapani","TP","91100"],
    ["Agrigento","AG","92100"],["Caltanissetta","CL","93100"],["Enna","EN","94100"],
    ["Marsala","TP","91025"],["Gela","CL","93012"],["Vittoria","RG","97019"],
    // Sardegna
    ["Cagliari","CA","09100"],["Sassari","SS","07100"],["Nuoro","NU","08100"],
    ["Oristano","OR","09170"],["Olbia","SS","07026"],["Alghero","SS","07041"],
];

// =============================================
//  AUTOCOMPLETE CITTÀ
//  mode: 'citta'     → input libero, suggerisce "Roma (RM)"
//  mode: 'indirizzo' → si attiva dopo la 1ª virgola,
//                       suggerisce "Città (PR), CAP"
// =============================================
window.setupCittaAutocomplete = function (inputId, mode) {
    const input = document.getElementById(inputId);
    if (!input || !window.COMUNI_IT) return;

    // Dropdown container
    const formGroup = input.closest('.form-group');
    if (!formGroup) return;
    formGroup.style.position = 'relative';

    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    formGroup.appendChild(dropdown);

    let selectedIdx = -1;

    function hideDropdown() {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        selectedIdx = -1;
    }

    function showSuggestions(items, prefix) {
        dropdown.innerHTML = '';
        selectedIdx = -1;

        items.forEach(([nome, prov, cap]) => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';

            if (mode === 'indirizzo') {
                // Mostra solo città e provincia — il CAP è personale (varia per via/quartiere)
                div.textContent = `${nome} (${prov}), …`;
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    // Posiziona il cursore dopo la virgola così l'utente digita subito il suo CAP
                    input.value = prefix + `${nome} (${prov}), `;
                    hideDropdown();
                    input.focus();
                });
            } else {
                div.textContent = `${nome} (${prov})`;
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    input.value = `${nome} (${prov})`;
                    hideDropdown();
                    input.focus();
                });
            }
            dropdown.appendChild(div);
        });

        dropdown.style.display = items.length > 0 ? 'block' : 'none';
    }

    function getQuery() {
        const val = input.value;
        if (mode === 'indirizzo') {
            const commas = (val.match(/,/g) || []).length;
            if (commas !== 1) return { query: null, prefix: '' };
            const commaIdx = val.indexOf(',');
            const streetPart = val.substring(0, commaIdx).trimEnd();
            const query = val.substring(commaIdx + 1).trim().toLowerCase();
            return { query, prefix: streetPart + ', ' };
        } else {
            return { query: val.trim().toLowerCase(), prefix: '' };
        }
    }

    input.addEventListener('input', () => {
        const { query, prefix } = getQuery();
        if (!query || query.length < 2) { hideDropdown(); return; }

        const results = window.COMUNI_IT.filter(([nome]) => {
            const n = nome.toLowerCase();
            return n.startsWith(query) || n.includes(' ' + query);
        }).slice(0, 8);

        if (results.length === 0) { hideDropdown(); return; }
        showSuggestions(results, prefix);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (dropdown.style.display === 'none' || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
            items.forEach((item, i) => item.classList.toggle('active', i === selectedIdx));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIdx = Math.max(selectedIdx - 1, 0);
            items.forEach((item, i) => item.classList.toggle('active', i === selectedIdx));
        } else if (e.key === 'Enter' && selectedIdx >= 0) {
            e.preventDefault();
            items[selectedIdx].dispatchEvent(new MouseEvent('mousedown'));
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    });

    input.addEventListener('blur', () => {
        // Piccolo delay per permettere il click sull'item
        setTimeout(hideDropdown, 150);
    });
};
