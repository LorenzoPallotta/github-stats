# GitHub Stats

Sito statico (GitHub Pages) che mostra le statistiche GitHub di chi accede, **repository privati inclusi**.
Il login usa una **GitHub App**; l'unico passaggio lato server (scambio *codice → token*) lo fa un
**Cloudflare Worker** gratuito. Tutto il resto gira nel browser dell'utente: nessun dato viene salvato.

```
github-stats/
├── docs/              ← il sito (GitHub Pages pubblica questa cartella)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── config.js      ← da compilare (3 valori)
└── worker/            ← Cloudflare Worker per il login
    ├── src/index.js
    └── wrangler.toml  ← da compilare (ALLOWED_ORIGIN)
```

## Cosa mostra

- Profilo, **iscritto da**, follower
- Contributi totali (di tutti gli anni, privati compresi), **streak attuale e più lunga**
- Calendario degli ultimi 12 mesi, contributi per anno, giorno della settimana preferito
- Linguaggi (per dimensione del codice, fork esclusi)
- **Traffico** degli ultimi 14 giorni (visite e cloni) dei tuoi repository
- Tabella dei repository con filtro e ordinamento
- Curiosità: giorno record, mese record, % PR unite, repo più stellato, primo repo…

> La streak si basa sul calendario dei contributi di GitHub (commit, PR, issue, review…), non solo sui push.

---

## Configurazione (circa 15 minuti)

Sostituisci `TUONOME` con il tuo nome utente GitHub.

### 1. Pubblica il sito su GitHub Pages

1. Crea un repository chiamato, per esempio, `github-stats` e carica tutto il contenuto di questa cartella.
2. **Settings → Pages → Build and deployment**: *Source* = **Deploy from a branch**, branch **main**, cartella **/docs** → *Save*.
3. Dopo un minuto il sito è su `https://TUONOME.github.io/github-stats/`.

### 2. Crea la GitHub App

**Settings (del tuo profilo) → Developer settings → GitHub Apps → New GitHub App**

| Campo | Valore |
|---|---|
| GitHub App name | un nome unico, es. `stats-di-tuonome` |
| Homepage URL | `https://TUONOME.github.io/github-stats/` |
| Callback URL | `https://TUONOME.github.io/github-stats/` (**identico**, con lo slash finale) |
| Expire user authorization tokens | lascialo attivo (i token scadono dopo 8 ore: più sicuro) |
| Request user authorization (OAuth) during installation | ✅ **attivo** |
| Webhook → Active | ❌ **disattivato** |

**Permissions → Repository permissions** (tutto in sola lettura):

| Permesso | Livello | Serve per |
|---|---|---|
| Metadata | Read-only (obbligatorio) | repository, linguaggi, stelle |
| Administration | Read-only | traffico (visite e cloni) |
| Contents | Read-only | facoltativo, statistiche dei commit |

**Where can this GitHub App be installed?** → **Any account** (così può usarla chiunque).

Premi **Create GitHub App**, poi nella pagina dell'app:
- copia il **Client ID** (inizia con `Iv…`);
- premi **Generate a new client secret** e copialo subito (non verrà più mostrato);
- annota lo **slug** dell'app: è la parte finale di `https://github.com/apps/<slug>`.

### 3. Pubblica il Worker su Cloudflare (gratis)

Serve un account gratuito su <https://dash.cloudflare.com> e Node.js installato.

```bash
cd worker
# imposta il tuo dominio Pages in wrangler.toml:  ALLOWED_ORIGIN = "https://TUONOME.github.io"
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_ID       # incolla il Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET   # incolla il Client secret
npx wrangler deploy
```

Alla fine Wrangler stampa l'indirizzo, es. `https://github-stats-auth.TUONOME.workers.dev`.

> In alternativa, senza riga di comando: Cloudflare → *Workers & Pages* → *Create* → *Hello World*,
> incolla il contenuto di `worker/src/index.js`, poi in *Settings → Variables and Secrets* aggiungi
> `ALLOWED_ORIGIN` (testo) e `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (secret).

### 4. Compila `docs/config.js`

```js
window.APP_CONFIG = {
  CLIENT_ID: "Iv23li…",
  WORKER_URL: "https://github-stats-auth.TUONOME.workers.dev",
  APP_SLUG: "stats-di-tuonome",
};
```

Fai commit e push: dopo un minuto il sito è aggiornato.

### 5. Prova

Apri il sito → **Accedi con GitHub** → autorizza. Per includere i repository privati usa **Scegli repository**
(installa l'app sul tuo account e seleziona i repository, o “All repositories”).

---

## Sicurezza

- Il **client secret** vive solo nei secret del Worker, mai nel codice del sito.
- Il token dell'utente resta in `sessionStorage` (si cancella chiudendo la scheda) e viene inviato **solo** a `api.github.com`.
- La pagina ha una Content-Security-Policy che blocca script esterni e permette connessioni solo a GitHub e al Worker.
- Il Worker accetta richieste solo dal dominio indicato in `ALLOWED_ORIGIN`.
- Tutti i permessi della GitHub App sono in **sola lettura**.

## Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| “redirect_uri mismatch” | La *Callback URL* dell'app non è identica all'indirizzo del sito (attenzione allo slash finale). |
| “Accesso non riuscito (exchange_failed)” | Client ID/secret sbagliati nel Worker, oppure codice già usato (ricarica e riaccedi). |
| Errore CORS sul Worker | `ALLOWED_ORIGIN` diverso dal dominio del sito (deve essere `https://TUONOME.github.io`, senza percorso). |
| Nessun repository privato | L'app non è installata su quei repository: usa “Scegli repository”. |
| Traffico non disponibile | Manca il permesso *Administration: Read-only* (dopo averlo aggiunto, l'utente deve accettare i nuovi permessi). |

## Idee per le prossime versioni

- Storico del traffico oltre i 14 giorni (GitHub Action che salva i dati ogni giorno).
- Badge SVG da incorporare nel README del profilo.
- Statistiche delle pull request (tempo di merge, review ricevute).
