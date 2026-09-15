# ARPA Activity Tracker

Dashboard web statica, open source e senza backend per il monitoraggio delle attività ARPA/BIP tramite CSV.

## Funzioni

- KPI automatici: totale attività, da iniziare, in corso, alta priorità aperte, avanzamento.
- Grafici dinamici per stato e ambito.
- Ricerca e filtri per stato, priorità, ambito e owner.
- Evidenza scadenze superate / entro 7 giorni.
- Caricamento di un nuovo CSV dal browser.
- Modifica, inserimento ed eliminazione attività.
- Salvataggio di una bozza nel browser (`localStorage`).
- Esportazione del CSV aggiornato.
- Layout responsive, utilizzabile anche da tablet.

## Schema CSV

La dashboard usa queste colonne, nello stesso ordine:

`ID, Ambito, Descrizione attività, Stato, Priorità, Owner ARPA, Owner BIP, Data apertura, Data chiusura, Scadenza, Note aggiuntive / Storico`

Formato data consigliato: `GG/MM/AAAA`.

## Pubblicazione gratuita su GitHub Pages

1. Crea un nuovo repository GitHub, ad esempio `arpa-activity-tracker`.
2. Carica tutto il contenuto di questa cartella mantenendo la sottocartella `data`.
3. In GitHub vai su **Settings → Pages**.
4. In **Build and deployment** scegli **Deploy from a branch**.
5. Seleziona branch `main` e cartella `/ (root)`, quindi salva.
6. Dopo il deploy GitHub mostrerà l'indirizzo pubblico della dashboard.

## Come aggiornare i dati condivisi

La dashboard pubblica legge sempre:

`data/TODO.csv`

Puoi lavorare in due modi.

### Metodo consigliato

1. Apri la dashboard.
2. Premi **Carica CSV** oppure modifica direttamente le attività.
3. Premi **Esporta CSV**.
4. In GitHub sostituisci `data/TODO.csv` con il file esportato e fai commit.
5. La dashboard pubblica mostrerà automaticamente i nuovi dati dopo il deploy.

### Modifica temporanea

Il pulsante **Salva bozza** salva i dati solamente nel browser utilizzato. Questa modalità è utile per lavorare prima di pubblicare il nuovo CSV, ma non modifica il file online.

## Nota sulla collaborazione

Questa versione è volutamente semplice: chiunque abbia l'URL può vedere la dashboard, ma solo chi ha accesso al repository GitHub può modificare il CSV pubblicato.

Se si desidera modifica multiutente direttamente online, autenticazione e storico centralizzato, il passo successivo è collegare la stessa interfaccia a un database open source (ad esempio Supabase/PostgreSQL) o a un foglio condiviso.
