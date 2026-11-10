import { ArrowLeft } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

// Fill these at build time (.env): the text below is a template to be reviewed by the DPO/legal.
const CONTROLLER = import.meta.env.VITE_PRIVACY_CONTROLLER || '[Titolare del trattamento: ragione sociale, sede, P.IVA]';
const CONTACT = import.meta.env.VITE_PRIVACY_EMAIL || '[email privacy]';
const HOSTING = import.meta.env.VITE_PRIVACY_HOSTING || "[fornitore e paese dei server, es. data center nell'Unione europea]";
const UPDATED = '9 novembre 2026';

export function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <main className="main main-narrow" style={{ paddingTop: 'calc(var(--safe-top) + 1rem)', paddingBottom: 'calc(var(--safe-bottom) + 2rem)' }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}>
        <ArrowLeft size={18} /> Indietro
      </button>
      <article className="prose" style={{ marginTop: '1rem' }}>
        <p className="eyebrow">Informativa ai sensi degli artt. 13–14 GDPR</p>
        <h1>Privacy</h1>
        <p className="muted small">Ultimo aggiornamento: {UPDATED}</p>

        <h2>Titolare</h2>
        <p>
          {CONTROLLER}. Per qualsiasi richiesta: {CONTACT}.
        </p>

        <h2>Quali dati trattiamo</h2>
        <ul>
          <li>Dati del tuo account: nome, email, password (conservata solo come hash Argon2id).</li>
          <li>I biglietti da visita che salvi: dati di contatto delle persone, foto del biglietto, note, tag.</li>
          <li>Dati tecnici di sicurezza: indirizzo IP nei log del server e informazioni sulla sessione, per prevenire abusi.</li>
        </ul>

        <h2>Riconoscimento del testo sul dispositivo</h2>
        <p>
          Il testo dei biglietti viene letto da un motore OCR che gira interamente sul tuo telefono o computer. Le immagini non
          vengono inviate a servizi di intelligenza artificiale, OCR esterni o modelli linguistici. Al server arrivano solo i
          campi che decidi di salvare e la foto ritagliata.
        </p>

        <h2>Perché e su quale base</h2>
        <p>
          Trattiamo i dati per fornirti il servizio che hai richiesto (art. 6.1.b GDPR) e per proteggerlo da accessi abusivi
          (legittimo interesse, art. 6.1.f). Non usiamo i dati per pubblicità o profilazione e non li vendiamo.
        </p>

        <h2>Dati delle persone nei biglietti</h2>
        <p>
          Quando salvi il biglietto di un'altra persona decidi tu come usarne i dati: per questi dati agiamo per tuo conto e li
          trattiamo solo per conservarli, cercarli ed esportarli quando lo chiedi. Usali nel rispetto della normativa, ad esempio
          per ricontattare chi ti ha dato il biglietto.
        </p>

        <h2>Condivisione con il team</h2>
        <p>
          Se entri in un team (ad esempio la rubrica condivisa Cosedil), i membri vedono il tuo nome e la tua email. Un
          biglietto arriva ai colleghi solo quando scegli tu di condividerlo, e di quel biglietto vedono soltanto i dati
          stampati e le foto: note, tag, evento e promemoria restano visibili solo a te. Puoi smettere di condividere o
          uscire dal team in qualsiasi momento; le copie che un collega ha già salvato nel proprio wallet restano sue.
        </p>

        <h2>Promemoria e notifiche</h2>
        <p>
          Se attivi le notifiche, il browser crea un indirizzo di consegna presso il servizio di notifiche del produttore
          (Apple, Google, Mozilla o Microsoft) e noi lo conserviamo per inviarti, al massimo una volta al giorno, quanti
          contatti hai da ricontattare. Il messaggio viaggia cifrato e contiene solo il nome del primo contatto. Le
          notifiche si disattivano dal browser o dalle impostazioni dell'app.
        </p>

        <h2>Dove e come sono conservati</h2>
        <p>
          Server: {HOSTING}. Le connessioni sono cifrate (HTTPS/TLS), il database è su un server separato non raggiungibile da
          internet, le foto sono cifrate con AES-256 e vengono fatti backup giornalieri cifrati.
        </p>

        <h2>Per quanto tempo</h2>
        <p>
          Finché mantieni l'account. Se lo elimini, cancelliamo subito account, biglietti e foto; le copie nei backup vengono
          sovrascritte entro 30 giorni.
        </p>

        <h2>Email di servizio</h2>
        <p>
          Le email di conferma dell'account e di reimpostazione della password sono inviate tramite AgentMail Inc.
          (Stati Uniti), che riceve solo il tuo indirizzo email e il testo del messaggio. Il trasferimento avviene sulla
          base delle clausole contrattuali standard della Commissione europea. Nessun dato dei biglietti viene inviato a
          questo fornitore.
        </p>

        <h2>Cookie e tracciamento</h2>
        <p>
          Usiamo un solo cookie tecnico, necessario per mantenerti connesso. Nessun cookie di profilazione, nessuno strumento
          di analisi di terze parti; i caratteri tipografici sono serviti dai nostri server.
        </p>

        <h2>I tuoi diritti</h2>
        <p>
          Puoi accedere ai tuoi dati, correggerli, scaricarli in formato leggibile (Impostazioni → Scarica tutti i miei dati),
          cancellarli (Impostazioni → Elimina account), limitarne od opporti al trattamento scrivendo a {CONTACT}. Puoi
          proporre reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).
        </p>
      </article>
    </main>
  );
}
