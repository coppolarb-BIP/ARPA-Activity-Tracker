# ARPA Activity Tracker V2

Dashboard web multiutente per il monitoraggio delle attività ARPA/BIP.

La V2 sostituisce il CSV pubblicato su GitHub come database con **Supabase**. GitHub Pages ospita solo il front-end; i dati sono nel database e sono leggibili solo dopo login grazie alle policy **Row Level Security (RLS)**.

## Funzioni

- Login con email e password.
- Ruoli **Viewer / Editor / Admin**.
- Aggiornamento multiutente e refresh automatico in tempo reale.
- KPI, avanzamento, scaduti, grafici, ricerca e filtri.
- Inserimento e modifica direttamente dalla dashboard.
- Eliminazione riservata all'Admin.
- Storico automatico di creazioni, modifiche ed eliminazioni con utente e data/ora.
- Import CSV riservato all'Admin.
- Export CSV disponibile agli utenti autenticati.
- Gestione dei ruoli degli utenti direttamente dalla dashboard da parte dell'Admin.
- Cambio password dalla dashboard.

## Colonne operative mantenute dal TODO.xlsx

1. `ID`
2. `Ambito`
3. `Descrizione attività`
4. `Riferimenti attività`
5. `Stato`
6. `Priorità`
7. `Owner ARPA`
8. `Owner BIP`
9. `Data apertura`
10. `Data chiusura`
11. `Scadenza`
12. `Note aggiuntive / Storico`

Il database aggiunge soltanto campi tecnici non visibili nel CSV, ad esempio `row_id`, autore e data dell'ultima modifica.

---

# Installazione passo passo

## 1. Crea un progetto Supabase

Vai su https://supabase.com/ e crea un nuovo progetto dedicato, ad esempio:

`ARPA Activity Tracker`

Conserva la password del database in modo sicuro.

## 2. Crea database, ruoli e storico

Nel progetto Supabase apri **SQL Editor**, crea una nuova query, incolla tutto il contenuto di:

`supabase-schema.sql`

poi esegui **Run**.

Lo script crea:

- `profiles`
- `activities`
- `audit_log`
- ruoli Viewer / Editor / Admin
- policy RLS
- trigger per storico e metadati
- supporto Realtime

## 3. Crea il tuo account Admin

Nel pannello Supabase vai in **Authentication → Users** e crea il tuo utente con email e una password temporanea.

Dopo aver creato l'utente, torna in **SQL Editor** ed esegui:

```sql
update public.profiles
set role = 'admin', updated_at = now()
where lower(email) = lower('LA-TUA-EMAIL@DOMINIO.IT');
```

Sostituisci la mail con quella effettiva.

## 4. Crea i 5 utenti che devono modificare

In **Authentication → Users** crea gli altri account.

Inizialmente vengono creati come `viewer`.

Dopo il primo accesso come Admin, nella dashboard troverai il pulsante **Utenti**: assegna ai 5 utenti il ruolo `editor`.

- **Viewer**: visualizza e filtra.
- **Editor**: visualizza, crea e modifica attività.
- **Admin**: tutto ciò che fa Editor + import CSV, eliminazione e gestione ruoli.

Per ragioni di sicurezza, la dashboard non consente all'Admin di togliersi da solo il ruolo Admin.

## 5. Recupera URL e Publishable Key

Nel progetto Supabase usa il pulsante **Connect** oppure la sezione delle API keys e recupera:

- Project URL, ad esempio `https://xxxx.supabase.co`
- **Publishable Key**, con formato simile a `sb_publishable_...`

Apri `config.js` e sostituisci i due valori:

```javascript
window.ARPA_TRACKER_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxx"
};
```

**Non inserire mai una Secret Key o una `service_role` nel sito o nel repository.**

Supabase considera la Publishable Key adatta a componenti pubblici/browser; l'accesso ai dati viene protetto dalle policy RLS.

Documentazione: https://supabase.com/docs/guides/getting-started/api-keys

## 6. Sostituisci la V1 nel repository GitHub

Nel repository `ARPA-Activity-Tracker` carica nella root:

```text
index.html
app.js
styles.css
config.js
supabase-schema.sql
README.md
.gitignore
```

Puoi caricare anche:

```text
data/TODO_TEMPLATE.csv
```

ma **NON caricare il CSV reale con le attività** nel repository pubblico.

La struttura sarà:

```text
ARPA-Activity-Tracker/
├── index.html
├── app.js
├── styles.css
├── config.js
├── supabase-schema.sql
├── README.md
├── .gitignore
└── data/
    └── TODO_TEMPLATE.csv
```

### Attenzione al vecchio `data/TODO.csv`

La V2 non usa più `data/TODO.csv`.

Se non lo hai ancora caricato nel repository pubblico, non farlo.

Se un CSV con dati reali è già stato committato in un repository pubblico, cancellarlo dalla cartella corrente non elimina automaticamente le copie presenti nella cronologia Git. In presenza di dati che non devono essere pubblici, valuta un nuovo repository pulito o la rimozione della cronologia prima di continuare.

## 7. GitHub Pages

In GitHub apri:

**Settings → Pages**

Imposta:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/(root)`

Il link rimarrà simile a:

`https://coppolarb-bip.github.io/ARPA-Activity-Tracker/`

Il repository può contenere il codice pubblico, perché i dati non sono più dentro GitHub. La dashboard non mostra dati fino a quando un utente non effettua il login e Supabase autorizza la richiesta.

## 8. Primo caricamento dei dati

Accedi alla dashboard con l'utente Admin.

Premi **Importa CSV** e seleziona il file CSV convertito dal tuo Excel, ad esempio `TODO_convertito.csv`.

L'import:

- aggiorna le attività che hanno lo stesso `ID`;
- inserisce quelle nuove;
- mantiene le 12 colonne originali;
- riallinea la numerazione automatica dei nuovi ID.

Dopo l'import il CSV non deve essere caricato su GitHub.

## 9. Uso quotidiano

Gli utenti lavorano direttamente dal link GitHub Pages.

### Viewer

Può:

- visualizzare;
- filtrare;
- cercare;
- vedere lo storico;
- esportare CSV.

### Editor

Può inoltre:

- creare attività;
- modificare attività.

### Admin

Può inoltre:

- eliminare attività;
- importare CSV;
- assegnare ruoli agli utenti.

Ogni modifica viene scritta nel database e gli altri utenti collegati ricevono l'aggiornamento automaticamente.

---

# Sicurezza

La sicurezza della V2 non dipende dal fatto che `config.js` sia nascosto: una web app eseguita nel browser è per definizione ispezionabile.

Per questo la configurazione usa esclusivamente la **Publishable Key** e il database applica RLS:

- utenti non autenticati: nessun accesso alle attività;
- Viewer: SELECT;
- Editor: SELECT / INSERT / UPDATE;
- Admin: SELECT / INSERT / UPDATE / DELETE + gestione ruoli.

Non usare nel browser chiavi segrete Supabase.

Riferimenti ufficiali:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword

---

# Nota sulle date

Le colonne `Data apertura`, `Data chiusura` e `Scadenza` restano testuali per essere pienamente compatibili con il file originario, che contiene anche valori come `na`.

Per il calcolo delle scadenze, la dashboard riconosce principalmente il formato:

`gg/mm/aaaa`

oltre al formato ISO `aaaa-mm-gg`.
