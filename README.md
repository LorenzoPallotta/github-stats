# GitHub Stats

**[English](#english) · [Italiano](#italiano)**

---

<a id="english"></a>

## English

GitHub Stats shows you a full picture of your activity on GitHub: contributions, streaks, languages, repositories, stars and traffic.

Most GitHub stats tools and profile cards only see your public repositories. This one can also include your **private repositories**, as long as you give it permission. You decide which repositories it can see, and you can change your mind at any time.

**👉 [Open GitHub Stats](https://lorenzopallotta.github.io/github-stats/)**

### What you get

- Your contribution calendar for the last 12 months
- Current streak and longest streak
- Total contributions, with how many of them were in private repositories
- Contributions year by year, and which day of the week you code the most
- The languages you use the most
- A few fun facts: your best day, your best month, your most starred repo, your first repo, how many of your pull requests got merged
- Views and clones of your repositories over the last 14 days (the same numbers you find under Insights → Traffic, but all in one place)
- A list of all your repositories that you can search and sort
- A card you can put in your profile README, so others can see your stats too (private ones included)

### How to use it

1. Open the site and click **Sign in with GitHub**.
2. GitHub asks you to authorize the app. Accept.
3. Your stats load. At this point you only see public data.
4. To add private repositories, click **Choose repositories** at the top. GitHub opens a page where you can pick "All repositories" or select only some of them.
5. Go back to the site: your private repositories are now part of the stats.

When you're done, click **Sign out**.

### Add a card to your README

You can show your stats on your GitHub profile, like this:

![Example card](https://github-stats-auth.lorenzo-pallotta99.workers.dev/card/lorenzopallotta.svg)

1. Sign in on the site and scroll down to **Card for your README**.
2. Click **Publish card**.
3. Copy the line it gives you and paste it into any `.md` file, for example the README of your profile repository (the one named like your username).

The line looks like this:

```md
![My GitHub stats](https://github-stats-auth.lorenzo-pallotta99.workers.dev/card/YOUR-USERNAME.svg)
```

If you want the card to switch to dark mode when the reader uses GitHub's dark theme, use the HTML version shown on the site instead. You can also add `?theme=dark` to the link to always get the dark version.

The card doesn't update by itself. When you want fresh numbers, come back to the site and click **Update card**. GitHub may take up to 30 minutes to show the new version. To take it down, click **Remove card**.

### What the app can access

The app asks for **read-only** access. It can't change, create or delete anything on your account.

It can read:

- the list of your repositories and their basic info (name, language, stars, forks)
- your contributions
- views and clones of your repositories
- the number of issues and pull requests you opened
- your followers and the repositories you starred

For private repositories, it only sees the ones you picked in step 4. Repositories you didn't select stay invisible to it.

### Your data

Your stats are read directly by your browser from GitHub. Nothing is saved on a server and there are no trackers or analytics.

The only exception is the card, and only if you publish it: in that case the numbers shown on the card (contributions, streaks, languages and so on) are saved so the image can be displayed in READMEs. Your login is never saved. Once you remove the card, those numbers are deleted. Your login lasts until you close the tab or click **Sign out**, and it expires on its own after 8 hours anyway.

### Removing access

You can take back access whenever you want from your GitHub settings:

- **Settings → Applications → Installed GitHub Apps**: change which repositories the app can see, or uninstall it.
- **Settings → Applications → Authorized GitHub Apps**: revoke the authorization entirely.

### Something not working?

- **No private repositories showing up**: click **Choose repositories** and check that they're selected.
- **"Session expired"**: sign in again.
- **Traffic section is empty**: GitHub only shares traffic for repositories you own or can write to, and only for the last 14 days.
- **Organization repositories missing**: the app has to be installed on the organization too, and an organization admin may need to approve it.

<p align="right"><a href="#github-stats">Back to top ↑</a></p>

---

<a id="italiano"></a>

## Italiano

GitHub Stats ti mostra un quadro completo della tua attività su GitHub: contributi, streak, linguaggi, repository, stelle e traffico.

La maggior parte dei siti e delle card di statistiche per GitHub vede solo i repository pubblici. Questo può includere anche i tuoi **repository privati**, se gli dai il permesso. Sei tu a scegliere quali repository può vedere, e puoi cambiare idea quando vuoi.

**👉 [Apri GitHub Stats](https://lorenzopallotta.github.io/github-stats/)**

### Cosa trovi

- Il calendario dei contributi degli ultimi 12 mesi
- La streak attuale e quella più lunga
- I contributi totali, con quanti sono stati fatti su repository privati
- I contributi anno per anno e il giorno della settimana in cui programmi di più
- I linguaggi che usi di più
- Qualche curiosità: il tuo giorno migliore, il mese migliore, il repo con più stelle, il tuo primo repo, quante delle tue pull request sono state accettate
- Visite e cloni dei tuoi repository negli ultimi 14 giorni (gli stessi numeri che trovi in Insights → Traffic, ma tutti insieme)
- L'elenco di tutti i tuoi repository, con ricerca e ordinamento
- Una card da mettere nel README del tuo profilo, così anche gli altri vedono le tue statistiche (comprese quelle private)

### Come si usa

1. Apri il sito e clicca **Sign in with GitHub**.
2. GitHub ti chiede di autorizzare l'app. Accetta.
3. Le statistiche si caricano. Per ora vedi solo i dati pubblici.
4. Per aggiungere i repository privati, clicca **Choose repositories** in alto. GitHub apre una pagina dove puoi scegliere "All repositories" oppure selezionarne solo alcuni.
5. Torna sul sito: adesso i repository privati sono inclusi nelle statistiche.

Quando hai finito, clicca **Sign out**.

### Aggiungere una card al README

Puoi mostrare le tue statistiche sul tuo profilo GitHub, così:

![Esempio di card](https://github-stats-auth.lorenzo-pallotta99.workers.dev/card/lorenzopallotta.svg)

1. Accedi al sito e scorri fino a **Card for your README**.
2. Clicca **Publish card**.
3. Copia la riga che ti viene data e incollala in un qualsiasi file `.md`, per esempio il README del repository del tuo profilo (quello che si chiama come il tuo username).

La riga è fatta così:

```md
![Le mie statistiche GitHub](https://github-stats-auth.lorenzo-pallotta99.workers.dev/card/YOUR-USERNAME.svg)
```

Se vuoi che la card passi al tema scuro quando chi la guarda usa GitHub in dark mode, usa la versione HTML che trovi sul sito. Puoi anche aggiungere `?theme=dark` al link per avere sempre la versione scura.

La card non si aggiorna da sola. Quando vuoi i numeri aggiornati, torna sul sito e clicca **Update card**. GitHub può metterci fino a 30 minuti a mostrare la nuova versione. Per toglierla, clicca **Remove card**.

### A cosa ha accesso l'app

L'app chiede accesso in **sola lettura**. Non può modificare, creare o cancellare niente sul tuo account.

Può leggere:

- l'elenco dei tuoi repository e le informazioni di base (nome, linguaggio, stelle, fork)
- i tuoi contributi
- visite e cloni dei tuoi repository
- il numero di issue e pull request che hai aperto
- i tuoi follower e i repository che hai messo tra le stelle

Dei repository privati vede solo quelli che hai scelto al punto 4. Gli altri restano invisibili.

### I tuoi dati

Le statistiche vengono lette direttamente dal tuo browser da GitHub. Non viene salvato niente su nessun server e non ci sono tracker né analytics.

L'unica eccezione è la card, e solo se la pubblichi: in quel caso vengono salvati i numeri che compaiono sulla card (contributi, streak, linguaggi e così via), perché l'immagine possa essere mostrata nei README. Il tuo accesso non viene mai salvato. Quando togli la card, quei numeri vengono cancellati. L'accesso dura finché non chiudi la scheda o clicchi **Sign out**, e comunque scade da solo dopo 8 ore.

### Togliere l'accesso

Puoi revocare l'accesso quando vuoi dalle impostazioni di GitHub:

- **Settings → Applications → Installed GitHub Apps**: cambia i repository che l'app può vedere, oppure disinstallala.
- **Settings → Applications → Authorized GitHub Apps**: revoca del tutto l'autorizzazione.

### Qualcosa non funziona?

- **Non vedo i repository privati**: clicca **Choose repositories** e controlla che siano selezionati.
- **"Session expired"**: rifai l'accesso.
- **La sezione Traffic è vuota**: GitHub mostra il traffico solo dei repository tuoi o su cui puoi scrivere, e solo degli ultimi 14 giorni.
- **Mancano i repository di un'organizzazione**: l'app va installata anche sull'organizzazione, e potrebbe servire l'approvazione di un amministratore.

<p align="right"><a href="#github-stats">Torna su ↑</a></p>
