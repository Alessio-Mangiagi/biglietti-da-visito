/**
 * OCR-like transcripts of business cards with the fields we expect to extract.
 * Synthetic but modelled on real Italian/English layouts, including typical OCR noise
 * (© for @, spaces in domains, stray logo glyphs, O for 0). Add real anonymised cards to
 * `real/` as they are collected — the test picks up both.
 */
import type { ContactInputRaw } from '@cardvault/shared';

export interface Fixture {
  id: string;
  text: string;
  expect: Partial<ContactInputRaw>;
}

export const fixtures: Fixture[] = [
  {
    id: '01-cosedil-classic',
    text: `COSEDIL S.p.A.
Costruiamo il tuo domani
Ing. Marta Colombo
Direttore Tecnico
Via Vincenzo Giuffrida, 37 - 95128 Catania (CT)
Tel. +39 095 712 4483 | Cell. +39 333 812 4471
m.colombo@cosedilspa.com
www.cosedilspa.com`,
    expect: {
      prefix: 'Ing.',
      firstName: 'Marta',
      lastName: 'Colombo',
      company: 'COSEDIL S.p.A.',
      jobTitle: 'Direttore Tecnico',
      emails: ['m.colombo@cosedilspa.com'],
      phones: [
        { type: 'work', value: '+39 095 712 4483' },
        { type: 'mobile', value: '+39 333 812 4471' },
      ],
      website: 'www.cosedilspa.com',
      address: { street: 'Via Vincenzo Giuffrida, 37', city: 'Catania', postalCode: '95128', province: 'CT', country: 'Italia' },
    },
  },
  {
    id: '02-surname-caps',
    text: `Fabio RESTIVO
Geometra - Capo Cantiere
Edil Restivo S.r.l.
Contrada Petrulla snc
92027 Licata AG
M. 347 221 9087
fabio.restivo@edilrestivo.it`,
    expect: {
      firstName: 'Fabio',
      lastName: 'Restivo',
      company: 'Edil Restivo S.r.l.',
      jobTitle: 'Geometra - Capo Cantiere',
      phones: [{ type: 'mobile', value: '+39 347 221 9087' }],
      emails: ['fabio.restivo@edilrestivo.it'],
      address: { street: 'Contrada Petrulla snc', city: 'Licata', postalCode: '92027', province: 'AG', country: 'Italia' },
    },
  },
  {
    id: '03-ocr-noise-at',
    text: `~ ARCHITETTURA BIANCHI ~
Arch. Giulia Bianchi
Socio fondatore
Corso Venezia 12
20121 Milano MI
T 02 7601 4432
giulia.bianchi©studiobianchi.it
studiobianchi . it`,
    expect: {
      prefix: 'Arch.',
      firstName: 'Giulia',
      lastName: 'Bianchi',
      jobTitle: 'Socio fondatore',
      emails: ['giulia.bianchi@studiobianchi.it'],
      phones: [{ type: 'work', value: '+39 02 7601 4432' }],
      address: { street: 'Corso Venezia 12', city: 'Milano', postalCode: '20121', province: 'MI', country: 'Italia' },
    },
  },
  {
    id: '04-english-card',
    text: `Northwind Traders Ltd
James Whitaker
Head of Procurement
+44 20 7946 0958
james.whitaker@northwind.co.uk
northwind.co.uk`,
    expect: {
      firstName: 'James',
      lastName: 'Whitaker',
      company: 'Northwind Traders Ltd',
      jobTitle: 'Head of Procurement',
      emails: ['james.whitaker@northwind.co.uk'],
      website: 'northwind.co.uk',
      phones: [{ type: 'work', value: '+44 20 7946 0958' }],
    },
  },
  {
    id: '05-piva-not-phone',
    text: `IMPIANTI SUD SRL
Salvatore Greco
Responsabile Commerciale
Viale Africa 31, 95129 Catania
Tel 095 534 1120 Fax 095 534 1121
P.IVA 04512780874
info@impiantisud.it - s.greco@impiantisud.it`,
    expect: {
      firstName: 'Salvatore',
      lastName: 'Greco',
      company: 'IMPIANTI SUD SRL',
      jobTitle: 'Responsabile Commerciale',
      phones: [
        { type: 'work', value: '+39 095 534 1120' },
        { type: 'fax', value: '+39 095 534 1121' },
      ],
      emails: ['info@impiantisud.it', 's.greco@impiantisud.it'],
      address: { street: 'Viale Africa 31', city: 'Catania', postalCode: '95129', province: '', country: '' },
    },
  },
  {
    id: '06-name-title-same-line',
    text: `Luca Ferraro - CEO
Ferraro Digital Srl
luca@ferrarodigital.com
+39 328 556 7711
linkedin.com/in/lucaferraro`,
    expect: {
      firstName: 'Luca',
      lastName: 'Ferraro',
      jobTitle: 'CEO',
      company: 'Ferraro Digital Srl',
      emails: ['luca@ferrarodigital.com'],
      phones: [{ type: 'mobile', value: '+39 328 556 7711' }],
      socials: [{ network: 'linkedin', value: 'linkedin.com/in/lucaferraro' }],
    },
  },
  {
    id: '07-dott-ssa',
    text: `Studio Legale Martini & Associati
Avv. Chiara De Santis
Piazza Cavour 5 - 00193 Roma (RM)
Tel. 06 3211 5678
c.desantis@studiomartini.legal
PEC: chiara.desantis@pec.ordineavvocatiroma.it`,
    expect: {
      prefix: 'Avv.',
      firstName: 'Chiara',
      lastName: 'De Santis',
      company: 'Studio Legale Martini & Associati',
      phones: [{ type: 'work', value: '+39 06 3211 5678' }],
      address: { street: 'Piazza Cavour 5', city: 'Roma', postalCode: '00193', province: 'RM', country: 'Italia' },
    },
  },
  {
    id: '08-uppercase-everything',
    text: `CALCESTRUZZI ETNEI SPA
DOTT. ANTONIO RUSSO
AMMINISTRATORE DELEGATO
ZONA INDUSTRIALE BLOCCO PALMA I
95121 CATANIA
TEL. 095 291 3344
A.RUSSO@CALCESTRUZZIETNEI.IT`,
    expect: {
      prefix: 'DOTT.',
      firstName: 'Antonio',
      lastName: 'Russo',
      company: 'CALCESTRUZZI ETNEI SPA',
      jobTitle: 'AMMINISTRATORE DELEGATO',
      emails: ['a.russo@calcestruzzietnei.it'],
      phones: [{ type: 'work', value: '+39 095 291 3344' }],
    },
  },
  {
    id: '09-no-company-freelancer',
    text: `Sara Lombardi
Graphic Designer
sara.lombardi@gmail.com
+39 340 778 2210
instagram.com/sara.lombardi.design`,
    expect: {
      firstName: 'Sara',
      lastName: 'Lombardi',
      jobTitle: 'Graphic Designer',
      company: '',
      emails: ['sara.lombardi@gmail.com'],
      phones: [{ type: 'mobile', value: '+39 340 778 2210' }],
      socials: [{ network: 'instagram', value: 'instagram.com/sara.lombardi.design' }],
    },
  },
  {
    id: '10-o-for-zero',
    text: `TECNOSTRADE S.r.l.
Geom. Orazio Pappalardo
Ufficio Tecnico
Tel. O95 7l2 0099
Cell. 335 6O4 1188
o.pappalardo@tecnostrade.it`,
    expect: {
      prefix: 'Geom.',
      firstName: 'Orazio',
      lastName: 'Pappalardo',
      company: 'TECNOSTRADE S.r.l.',
      jobTitle: 'Ufficio Tecnico',
      phones: [
        { type: 'work', value: '+39 095 712 0099' },
        { type: 'mobile', value: '+39 335 604 1188' },
      ],
    },
  },
  {
    id: '11-surname-first',
    text: `Gruppo Ferretti Costruzioni
ROSSI Mario
Project Manager
mario.rossi@ferretticostruzioni.it
Mob +39 339 120 4455`,
    expect: {
      firstName: 'Mario',
      lastName: 'Rossi',
      company: 'Gruppo Ferretti Costruzioni',
      jobTitle: 'Project Manager',
      phones: [{ type: 'mobile', value: '+39 339 120 4455' }],
    },
  },
  {
    id: '12-two-line-title',
    text: `Enel Green Power S.p.A.
Elena Marchetti
Head of Business Development
Southern Europe
Viale Regina Margherita 125
00198 Roma
elena.marchetti@enel.com`,
    expect: {
      firstName: 'Elena',
      lastName: 'Marchetti',
      company: 'Enel Green Power S.p.A.',
      jobTitle: 'Head of Business Development',
      address: { street: 'Viale Regina Margherita 125', city: 'Roma', postalCode: '00198', province: '', country: '' },
    },
  },
  {
    id: '13-german',
    text: `Bauer Bautechnik GmbH
Dipl.-Ing. Klaus Bauer
Geschäftsführer
Hauptstraße 14
80331 München
Germany
Tel. +49 89 1234 5678
k.bauer@bauer-bautechnik.de`,
    expect: {
      company: 'Bauer Bautechnik GmbH',
      emails: ['k.bauer@bauer-bautechnik.de'],
      phones: [{ type: 'work', value: '+49 89 12345678' }],
      address: { street: 'Hauptstraße 14', city: 'München', postalCode: '80331', province: '', country: 'Germania' },
    },
  },
  {
    id: '14-particle-surname',
    text: `Vincenzo Lo Bianco
Responsabile Acquisti
SIDERMETAL SRL
Via dell'Industria 8, 90040 Carini (PA)
t. 091 866 2201
v.lobianco@sidermetal.it`,
    expect: {
      firstName: 'Vincenzo',
      lastName: 'Lo Bianco',
      company: 'SIDERMETAL SRL',
      jobTitle: 'Responsabile Acquisti',
      address: { street: "Via dell'Industria 8", city: 'Carini', postalCode: '90040', province: 'PA', country: 'Italia' },
    },
  },
  {
    id: '15-bullets-separators',
    text: `Paola Conti • Account Manager
Nova Software S.r.l.
+39 02 8734 1100 • +39 345 900 1212
paola.conti@novasoftware.it • novasoftware.it`,
    expect: {
      firstName: 'Paola',
      lastName: 'Conti',
      jobTitle: 'Account Manager',
      company: 'Nova Software S.r.l.',
      emails: ['paola.conti@novasoftware.it'],
      website: 'novasoftware.it',
      phones: [
        { type: 'work', value: '+39 02 8734 1100' },
        { type: 'mobile', value: '+39 345 900 1212' },
      ],
    },
  },
  {
    id: '16-logo-garbage',
    text: `|| ~~ //
@ 9
Termoidraulica Costa
di Costa Giovanni & C. s.n.c.
Giovanni Costa
Titolare
Cell 338 441 2020
Via Roma 101 - 98051 Barcellona P.G. (ME)`,
    expect: {
      firstName: 'Giovanni',
      lastName: 'Costa',
      jobTitle: 'Titolare',
      phones: [{ type: 'mobile', value: '+39 338 441 2020' }],
      address: { street: 'Via Roma 101', city: 'Barcellona P.G.', postalCode: '98051', province: 'ME', country: 'Italia' },
    },
  },
  {
    id: '17-email-name-only',
    text: `ACME Logistica
Ufficio Spedizioni
federica.galli@acmelogistica.it
Tel 0532 778899`,
    expect: {
      firstName: 'Federica',
      lastName: 'Galli',
      company: 'ACME Logistica',
      phones: [{ type: 'work', value: '+39 0532 778899' }],
    },
  },
  {
    id: '18-university',
    text: `Università degli Studi di Catania
Dipartimento di Ingegneria Civile e Architettura
Prof. Ing. Salvatore Caffo
Professore Ordinario
salvatore.caffo@unict.it
Tel. +39 095 738 2211`,
    expect: {
      prefix: 'Prof. Ing.',
      firstName: 'Salvatore',
      lastName: 'Caffo',
      company: 'Università degli Studi di Catania',
      jobTitle: 'Professore Ordinario',
    },
  },
  {
    id: '19-www-spaced',
    text: `Edilsud Group
Marco Messina
Direttore Commerciale
www. edilsudgroup .com
marco.messina@edilsudgroup.com
Mobile 393 120 3344`,
    expect: {
      firstName: 'Marco',
      lastName: 'Messina',
      company: 'Edilsud Group',
      website: 'www.edilsudgroup.com',
      phones: [{ type: 'mobile', value: '+39 393 120 3344' }],
    },
  },
  {
    id: '20-us-card',
    text: `Brightline Robotics Inc.
Emily Carter
Senior Product Manager
1200 Market Street, San Francisco, CA 94103
Office +1 415 867 2290
emily.carter@brightline.ai`,
    expect: {
      firstName: 'Emily',
      lastName: 'Carter',
      company: 'Brightline Robotics Inc.',
      jobTitle: 'Senior Product Manager',
      emails: ['emily.carter@brightline.ai'],
      phones: [{ type: 'work', value: '+1 415 867 2290' }],
    },
  },
  {
    id: '21-sede-legale',
    text: `CONSORZIO STABILE MEDITERRANEO
Ing. Paolo Arena
Presidente
Sede legale: Via Etnea 228 - 95131 Catania
Sede operativa: Z.I. VIII Strada 20 - Catania
info@csmediterraneo.it
Tel. 095 446 7788`,
    expect: {
      prefix: 'Ing.',
      firstName: 'Paolo',
      lastName: 'Arena',
      company: 'CONSORZIO STABILE MEDITERRANEO',
      jobTitle: 'Presidente',
      address: { street: 'Via Etnea 228', city: 'Catania', postalCode: '95131', province: '', country: '' },
    },
  },
  {
    id: '22-capital-noise',
    text: `ROMANO COSTRUZIONI S.R.L.
Cap. Soc. € 100.000,00 i.v. - REA CT-123456
Giuseppe Romano
Amministratore Unico
cell. 330 998 1122
g.romano@romanocostruzioni.it`,
    expect: {
      firstName: 'Giuseppe',
      lastName: 'Romano',
      company: 'ROMANO COSTRUZIONI S.R.L.',
      jobTitle: 'Amministratore Unico',
      phones: [{ type: 'mobile', value: '+39 330 998 1122' }],
    },
  },
  {
    id: '23-email-with-spaces',
    text: `Irene Fontana
Ufficio Marketing
Lavazza S.p.A.
irene.fontana @ lavazza . com
+39 011 239 8811`,
    expect: {
      firstName: 'Irene',
      lastName: 'Fontana',
      company: 'Lavazza S.p.A.',
      jobTitle: 'Ufficio Marketing',
      emails: ['irene.fontana@lavazza.com'],
      phones: [{ type: 'work', value: '+39 011 239 8811' }],
    },
  },
  {
    id: '24-ms-honorific-en',
    text: `Ms. Olivia Bennett
Chief Financial Officer
Harbour Capital LLC
olivia@harbourcapital.com
+44 7911 123456`,
    expect: {
      prefix: 'Ms.',
      firstName: 'Olivia',
      lastName: 'Bennett',
      company: 'Harbour Capital LLC',
      jobTitle: 'Chief Financial Officer',
      phones: [{ type: 'mobile', value: '+44 7911 123456' }],
    },
  },
  {
    id: '25-three-names',
    text: `Anna Maria Ferrante
Consulente HSE - RSPP
ferrante.annamaria@libero.it
cell 349 223 7711
Via Garibaldi, 44 - 97100 Ragusa`,
    expect: {
      firstName: 'Anna Maria',
      lastName: 'Ferrante',
      jobTitle: 'Consulente HSE - RSPP',
      company: '',
      phones: [{ type: 'mobile', value: '+39 349 223 7711' }],
      address: { street: 'Via Garibaldi, 44', city: 'Ragusa', postalCode: '97100', province: '', country: '' },
    },
  },
  {
    id: '26-francais',
    text: `BTP Provence SA
Pierre Martin
Directeur de travaux
12 rue de la République
13001 Marseille
France
+33 4 91 55 12 34
p.martin@btp-provence.fr`,
    expect: {
      firstName: 'Pierre',
      lastName: 'Martin',
      company: 'BTP Provence SA',
      phones: [{ type: 'work', value: '+33 4 91 55 12 34' }],
      address: { street: '12 rue de la République', city: 'Marseille', postalCode: '13001', province: '', country: 'Francia' },
    },
  },
  {
    id: '27-public-body',
    text: `Comune di Acireale
Area Tecnica - Lavori Pubblici
Arch. Davide Spina
Responsabile Unico del Procedimento
Piazza Duomo 1 - 95024 Acireale (CT)
095 895 111
davide.spina@comune.acireale.ct.it`,
    expect: {
      prefix: 'Arch.',
      firstName: 'Davide',
      lastName: 'Spina',
      company: 'Comune di Acireale',
      jobTitle: 'Responsabile Unico del Procedimento',
      address: { street: 'Piazza Duomo 1', city: 'Acireale', postalCode: '95024', province: 'CT', country: 'Italia' },
    },
  },
  {
    id: '28-whatsapp-label',
    text: `Pasticceria Santangelo
Rosaria Santangelo
WhatsApp 366 112 9090
ordini@pasticceriasantangelo.it
Corso Italia 77, 95127 Catania`,
    expect: {
      firstName: 'Rosaria',
      lastName: 'Santangelo',
      company: 'Pasticceria Santangelo',
      phones: [{ type: 'mobile', value: '+39 366 112 9090' }],
    },
  },
  {
    id: '29-github-dev',
    text: `Tommaso Ricci
Full Stack Developer
tommaso@ricci.dev
github.com/tommasoricci
+39 371 445 6677`,
    expect: {
      firstName: 'Tommaso',
      lastName: 'Ricci',
      jobTitle: 'Full Stack Developer',
      emails: ['tommaso@ricci.dev'],
      socials: [{ network: 'github', value: 'github.com/tommasoricci' }],
      phones: [{ type: 'mobile', value: '+39 371 445 6677' }],
    },
  },
  {
    id: '30-pipes-footer',
    text: `Ing. Federico Valenti
Engineering Manager
SALINI GROUP
Via della Dataria 22 | 00187 Roma | Italia
T +39 06 6776 1 | M +39 335 777 0101
f.valenti@salinigroup.com | salinigroup.com`,
    expect: {
      prefix: 'Ing.',
      firstName: 'Federico',
      lastName: 'Valenti',
      company: 'SALINI GROUP',
      jobTitle: 'Engineering Manager',
      website: 'salinigroup.com',
      emails: ['f.valenti@salinigroup.com'],
    },
  },
];
