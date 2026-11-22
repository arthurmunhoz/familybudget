# Landing copy, one dict per language. Every claim traces to
# marketing/fact-sheet.md + mobile/STORE-LISTING-1.6.0.md — don't add features,
# prices or stats that aren't there. Here competitor names appear ONLY as the
# category people already use them for (no claims about their products);
# the /vs/ pages (vs_copy.py) are the one place that compares, from their own sites.

EN = dict(
  lang='en', locale='en_US', path='/', apple='en-us', play_badge='en', play_hl='en_US',
  title='One Roof — Family Organizer App: Shared Calendar, Lists & Budget',
  description='The family organizer app for your whole household: shared calendar, shopping lists, budget, pet care and Roof, a voice assistant. Free on iPhone and Android.',
  og_title='One Roof — the family organizer app for everything your household shares',
  h1='The family organizer app for everything your household shares',
  tagline='A shared family calendar, shopping lists, a household budget, pet care and Roof — a voice assistant that does it for you. One app for the whole house, in sync on every phone.',
  free_note='Free to download · 30 days of Plus included, no card needed',
  casa_hint='Setting up Modo Casa on this screen?', casa_cta='Open Modo Casa',
  shots_alt=['One Roof home screen with the family agenda','Roof, the voice assistant, adding items to the list','Shared family calendar','Shared shopping list organized by store','Household budget with categories','Family games: Hangman, Battleship and a buzzer quiz','Modo Casa on a tablet: the family home screen','Pet care routine with vaccines and vet visits'],
  shots=['en-01-hero','en-02-roof','en-03-calendar','en-04-lists','en-06-money','en-07-games','en-08-casa','en-09-pets'],
  feat_h2='Everything a family app should do, in one place',
  feat_sub='Open one app, not five. Everyone at home sees the same calendar, the same lists and the same budget — live, on every phone.',
  features=[
    ('📅','Shared family calendar','Day, week and month views, color-coded by person, with birthdays, anniversaries and reminders. Syncs with Apple Calendar on iPhone, and two-way with Google Calendar on Plus.'),
    ('🛒','Shopping & grocery lists','Groceries by store, chores, a trip, school. Add an item and it appears on everyone\'s phone — keep adding with no signal; it syncs when you\'re back online.'),
    ('💰','Household budget','Shared budgets by month, week or day, with your own categories. Photograph a receipt and the amount, date and category fill themselves in.'),
    ('🎙️','Roof, the voice assistant','Say "Hey Roof": "milk and eggs on the list", "I spent 50 at the supermarket", "what\'s on tomorrow?". Roof does it and shows what changed, with Undo.'),
    ('🐾','Pet care','A shared daily routine with times, so nobody feeds the dog twice. Vet visits and vaccines, with a reminder before the next one is due.'),
    ('🎲','Family games','Hangman challenges, Battleship and a buzzer quiz — each person playing on their own phone.'),
    ('📣','Nudges','One tap for "on my way" or "dinner\'s ready", and see who has read it. On iPhone, send one straight from the Home Screen widget.'),
    ('📍','Whereabouts (iPhone)','A private family map with live locations and arrive/leave alerts for places you choose. Off by default, visible only to your household.'),
    ('🗂️','Documents','IDs, insurance and registrations kept together, with PDF previews — and a face or fingerprint lock on Plus.'),
    ('📺','Modo Casa','Turn a spare tablet or laptop into the family\'s home screen: agenda, lists, money and photos at a glance.'),
    ('🧮','Utilities','Split a bill (by item from a photo, on Plus), compare unit prices, work out a discount, print luggage tags, and run a family photo frame.'),
    ('👪','Family profiles','Everyone\'s details on one card: birthdays, phone numbers, clothing and shoe sizes, blood types.'),
  ],
  vs_h2='Using Cozi, TimeTree, AnyList and Life360 at the same time?',
  vs_sub='Most households end up with one app for the calendar, another for groceries, another for locations and a spreadsheet for money. One Roof puts them under one roof — one invite for everyone, one plan per household.',
  vs_head=('What your family needs','What people often use','In One Roof'),
  vs_rows=[
    ('Shared family calendar','Cozi, TimeTree, Google Calendar','Calendar with Google sync (Plus)'),
    ('Grocery & shopping list','AnyList, OurGroceries, a notes app','Lists by store, live on every phone'),
    ('Family location','Life360, Find My','Whereabouts (iPhone, opt-in)'),
    ('Household budget','A spreadsheet or a budgeting app','Money, with receipt scanning'),
    ('Family organizer hub','FamilyWall, a group chat','All of the above, plus pets, documents and Roof'),
  ],
  vs_note='Cozi, TimeTree, AnyList, OurGroceries, Life360, Find My, FamilyWall and Google Calendar are trademarks of their respective owners. One Roof is not affiliated with or endorsed by them.',
  privacy_h2='Your family\'s data is not the product',
  privacy_p='<strong>No ads. No tracking. We don\'t sell your data.</strong> Each household\'s information is walled off inside the database, visible to its members and nobody else.',
  faq_h2='Frequently asked questions',
  faq=[
    ('What is One Roof?','One Roof is a family organizer app that keeps a household\'s shared calendar, shopping lists, budget, pet care, documents and everyday messages in one place. Everyone in the household sees the same information, in sync, on iPhone and Android.'),
    ('Is One Roof free?','Yes, One Roof is free to download and use, and every new household gets 30 days of One Roof Plus included, with no card needed. After that, on the free plan, some features have usage limits, such as Roof requests and receipt scans. One Roof Plus is an optional subscription that removes those limits and adds two-way Google Calendar sync, multiple budgets and more — and one subscription covers the whole household, never per person.'),
    ('Is One Roof a good alternative to Cozi, TimeTree or FamilyWall?','If you want a shared family calendar together with grocery lists, a household budget, pet care and a family map, One Roof combines what families often split across Cozi or TimeTree (calendar), AnyList (groceries) and Life360 (location) into a single app.'),
    ('Does One Roof work on Android?','Yes. One Roof is on the App Store and Google Play. A few features are iPhone-only for now: Whereabouts (the family map), Home Screen widgets and Apple Calendar sync.'),
    ('Can my partner and I share a budget?','Yes. Budgets are shared with everyone in the household by default, by month, week or day, with categories you control. Plus also allows private budgets only you can see.'),
    ('Does the shopping list sync between phones?','Yes. Items appear on everyone\'s phone as soon as they are added, organized by store. You can keep adding with no signal and the changes upload once you\'re back online.'),
    ('What is Roof?','Roof is One Roof\'s voice assistant. Say "Hey Roof" and ask in your own words to add to a list, log an expense, check or move calendar events, or send a message to the family. It shows what it changed and lets you undo it.'),
    ('What is Modo Casa?','Modo Casa turns a spare tablet, laptop or TV browser into a shared family home screen with the agenda, lists, money and photos. Pair it from the app in a few seconds.'),
    ('Is my family\'s data private?','Yes. One Roof has no ads and no tracking, and does not sell data. Each household\'s information is isolated at the database level and visible only to its members.'),
    ('Which languages does One Roof support?','English, Spanish and Portuguese.'),
  ],
  story_h2='Why we built it',
  story_p='A paper notebook on the kitchen counter for groceries. Vet emails and bank receipts as the dogs\' medical records. "Did you feed the dogs?" twice a day. One Roof replaced all of it — built by a mobile developer in Tampa, FL for his own household (his wife and their two dogs) first, and shared once it actually stuck.',
  footer='One Roof · made with ❤️ in Tampa, FL',
  privacy_link='Privacy', support_link='Support',
)

PT = dict(
  lang='pt-BR', locale='pt_BR', path='/pt/', apple='pt-br', play_badge='pt-br', play_hl='pt_BR',
  title='One Roof — App para organizar a família: agenda, listas e orçamento',
  description='O app para organizar a família e a casa: agenda compartilhada, lista de compras, orçamento, cuidados com pets e o Roof, um assistente de voz. Grátis no iPhone e Android.',
  og_title='One Roof — o app para organizar tudo o que a sua casa compartilha',
  h1='O app para organizar a família e tudo o que a casa compartilha',
  tagline='Agenda familiar compartilhada, lista de compras, orçamento da casa, cuidados com os pets e o Roof — um assistente de voz que faz por você. Um app para a casa inteira, sincronizado em todos os celulares.',
  free_note='Grátis para baixar · 30 dias de Plus inclusos, sem cartão',
  casa_hint='Configurando o Modo Casa nesta tela?', casa_cta='Abrir o Modo Casa',
  shots_alt=['Tela inicial do One Roof com a agenda da família','Roof, o assistente de voz, no One Roof','Agenda familiar compartilhada','Lista de compras compartilhada por loja','Orçamento da casa com categorias','Mapa da família no One Roof','Rotina de cuidados com os pets','Utilidades: dividir a conta e comparar preços'],
  shots=['pt-01-hero','pt-02-assistant','pt-04-calendar','pt-05-shopping','pt-06-money','pt-07-location','pt-09-pets','pt-10-utilities'],
  feat_h2='Tudo o que um app de família deveria fazer, num só lugar',
  feat_sub='Abra um app, não cinco. Todo mundo em casa vê a mesma agenda, as mesmas listas e o mesmo orçamento — ao vivo, em todos os celulares.',
  features=[
    ('📅','Agenda familiar compartilhada','Visões de dia, semana e mês, com cor por pessoa, aniversários, datas especiais e lembretes. Sincroniza com o Calendário da Apple no iPhone e, no Plus, nos dois sentidos com o Google Agenda.'),
    ('🛒','Lista de compras e do mercado','Mercado por loja, tarefas, uma viagem, a escola. Adicione um item e ele aparece no celular de todos — dá para adicionar sem sinal; sincroniza quando a conexão volta.'),
    ('💰','Orçamento da casa','Orçamentos compartilhados por mês, semana ou dia, com as suas categorias. Fotografe um recibo e o valor, a data e a categoria se preenchem sozinhos.'),
    ('🎙️','Roof, o assistente de voz','Diga "Oi Casa": "leite e ovos na lista", "gastei 50 no mercado", "o que temos amanhã?". O Roof faz e mostra o que mudou, com Desfazer.'),
    ('🐾','Cuidados com os pets','Uma rotina diária compartilhada com horários, para ninguém dar comida ao cachorro duas vezes. Veterinário e vacinas, com lembrete antes da próxima.'),
    ('🎲','Jogos em família','Desafios de Forca, Batalha Naval e um quiz com campainha — cada um jogando no próprio celular.'),
    ('📣','Avisos','Um toque para "estou a caminho" ou "o jantar está pronto", e veja quem já leu. No iPhone, envie direto do widget da tela de início.'),
    ('📍','Localização (iPhone)','Um mapa privado da família com localização ao vivo e alertas de chegada e saída nos lugares que você escolher. Desligado por padrão, visível só para a sua casa.'),
    ('🗂️','Documentos','RG, seguros e registros guardados juntos, com prévia de PDF — e trava por rosto ou digital no Plus.'),
    ('📺','Modo Casa','Transforme um tablet ou notebook parado na tela inicial da família: agenda, listas, dinheiro e fotos num relance.'),
    ('🧮','Utilidades','Divida a conta (por item a partir de uma foto, no Plus), compare preços por unidade, calcule descontos, imprima etiquetas de mala e tenha um porta-retrato da família.'),
    ('👪','Perfis da família','Os dados de cada um num cartão: aniversário, telefone, tamanhos de roupa e calçado, tipo sanguíneo.'),
  ],
  vs_h2='Usando Cozi, TimeTree, AnyList e Life360 ao mesmo tempo?',
  vs_sub='A maioria das casas acaba com um app para a agenda, outro para o mercado, outro para a localização e uma planilha para o dinheiro. O One Roof junta tudo debaixo do mesmo teto — um convite para todos, um plano por casa.',
  vs_head=('O que a família precisa','O que muita gente usa','No One Roof'),
  vs_rows=[
    ('Agenda familiar compartilhada','Cozi, TimeTree, Google Agenda','Agenda com sincronização com o Google (Plus)'),
    ('Lista de compras','AnyList, OurGroceries, app de notas','Listas por loja, ao vivo em todos os celulares'),
    ('Localização da família','Life360, Buscar','Localização (iPhone, opcional)'),
    ('Orçamento da casa','Planilha ou app de finanças','Dinheiro, com leitura de recibos'),
    ('Central da família','FamilyWall, grupo de WhatsApp','Tudo isso, mais pets, documentos e o Roof'),
  ],
  vs_note='Cozi, TimeTree, AnyList, OurGroceries, Life360, Buscar, FamilyWall, Google Agenda e WhatsApp são marcas de seus respectivos donos. O One Roof não tem afiliação nem endosso deles.',
  privacy_h2='Os dados da sua família não são o produto',
  privacy_p='<strong>Sem anúncios. Sem rastreamento. Não vendemos seus dados.</strong> As informações de cada casa ficam isoladas no banco de dados, visíveis só para os membros dela.',
  faq_h2='Perguntas frequentes',
  faq=[
    ('O que é o One Roof?','O One Roof é um app para organizar a família que reúne a agenda compartilhada, a lista de compras, o orçamento, os cuidados com os pets, os documentos e os avisos do dia a dia da casa num só lugar. Todos da casa veem as mesmas informações, sincronizadas, no iPhone e no Android.'),
    ('O One Roof é grátis?','Sim, o One Roof é grátis para baixar e usar, e toda casa nova ganha 30 dias de One Roof Plus inclusos, sem cartão. Depois disso, no plano grátis, alguns recursos têm limite de uso, como os pedidos ao Roof e a leitura de recibos. O One Roof Plus é uma assinatura opcional que tira esses limites e traz sincronização com o Google Agenda, vários orçamentos e mais — e uma assinatura cobre a casa inteira, nunca por pessoa.'),
    ('O One Roof é uma boa alternativa ao Cozi, TimeTree ou FamilyWall?','Se você quer uma agenda familiar compartilhada junto com lista de compras, orçamento da casa, cuidados com pets e mapa da família, o One Roof junta num app só o que muitas famílias dividem entre Cozi ou TimeTree (agenda), AnyList (mercado) e Life360 (localização).'),
    ('O One Roof funciona no Android?','Sim. O One Roof está na App Store e no Google Play. Alguns recursos ainda são só do iPhone: Localização (o mapa da família), widgets da tela de início e sincronização com o Calendário da Apple.'),
    ('Dá para dividir o orçamento com o meu parceiro ou parceira?','Sim. Os orçamentos são compartilhados com todos da casa, por mês, semana ou dia, com categorias que vocês controlam. O Plus também permite orçamentos privados que só você vê.'),
    ('A lista de compras sincroniza entre os celulares?','Sim. Os itens aparecem no celular de todos assim que são adicionados, organizados por loja. Dá para adicionar sem sinal e as mudanças sobem quando a conexão volta.'),
    ('O que é o Roof?','O Roof é o assistente de voz do One Roof. Diga "Oi Casa" e peça com as suas palavras para adicionar à lista, lançar um gasto, ver ou mudar compromissos na agenda ou mandar um aviso para a família. Ele mostra o que mudou e deixa desfazer.'),
    ('O que é o Modo Casa?','O Modo Casa transforma um tablet, notebook ou navegador da TV numa tela inicial da família com agenda, listas, dinheiro e fotos. Você pareia pelo app em poucos segundos.'),
    ('Os dados da minha família ficam privados?','Sim. O One Roof não tem anúncios nem rastreamento e não vende dados. As informações de cada casa ficam isoladas no banco de dados e só os membros dela veem.'),
    ('Em quais idiomas o One Roof funciona?','Português, espanhol e inglês.'),
  ],
  story_h2='Por que criamos o One Roof',
  story_p='Um caderno de papel no balcão da cozinha para as compras. E-mails do veterinário e recibos do banco como prontuário dos cachorros. "Você deu comida para os cachorros?" duas vezes por dia. O One Roof substituiu tudo isso — feito por um desenvolvedor mobile em Tampa, na Flórida, primeiro para a própria casa (ele, a esposa e os dois cachorros), e compartilhado quando realmente pegou.',
  footer='One Roof · feito com ❤️ em Tampa, FL',
  privacy_link='Privacidade', support_link='Suporte',
)

ES = dict(
  lang='es', locale='es_MX', path='/es/', apple='es-mx', play_badge='es-419', play_hl='es_419',
  title='One Roof — App para organizar la familia: calendario, listas y presupuesto',
  description='La app para organizar la familia y el hogar: calendario compartido, lista de compras, presupuesto, cuidado de mascotas y Roof, un asistente de voz. Gratis en iPhone y Android.',
  og_title='One Roof — la app para organizar todo lo que comparte tu hogar',
  h1='La app para organizar la familia y todo lo que comparte tu hogar',
  tagline='Calendario familiar compartido, lista de compras, presupuesto del hogar, cuidado de mascotas y Roof — un asistente de voz que lo hace por ti. Una app para toda la casa, sincronizada en todos los teléfonos.',
  free_note='Gratis para descargar · 30 días de Plus incluidos, sin tarjeta',
  casa_hint='¿Configurando el Modo Casa en esta pantalla?', casa_cta='Abrir el Modo Casa',
  shots_alt=['Pantalla de inicio de One Roof con la agenda familiar','Roof, el asistente de voz, en One Roof','Calendario familiar compartido','Lista de compras compartida por tienda','Presupuesto del hogar con categorías','Mapa de la familia en One Roof','Rutina de cuidado de mascotas','Utilidades: dividir la cuenta y comparar precios'],
  shots=['es-01-hero','es-02-assistant','es-04-calendar','es-05-shopping','es-06-money','es-07-location','es-09-pets','es-10-utilities'],
  feat_h2='Todo lo que una app familiar debería hacer, en un solo lugar',
  feat_sub='Abre una app, no cinco. Todos en casa ven el mismo calendario, las mismas listas y el mismo presupuesto — en vivo, en todos los teléfonos.',
  features=[
    ('📅','Calendario familiar compartido','Vistas de día, semana y mes, con color por persona, cumpleaños, aniversarios y recordatorios. Sincroniza con el Calendario de Apple en iPhone y, con Plus, en ambos sentidos con Google Calendar.'),
    ('🛒','Lista de compras y del súper','El súper por tienda, tareas, un viaje, la escuela. Agrega un artículo y aparece en el teléfono de todos — puedes seguir agregando sin señal; se sincroniza al volver la conexión.'),
    ('💰','Presupuesto del hogar','Presupuestos compartidos por mes, semana o día, con tus propias categorías. Fotografía un recibo y el monto, la fecha y la categoría se llenan solos.'),
    ('🎙️','Roof, el asistente de voz','Di "Oye Casa": "leche y huevos a la lista", "gasté 50 en el súper", "¿qué hay mañana?". Roof lo hace y muestra qué cambió, con Deshacer.'),
    ('🐾','Cuidado de mascotas','Una rutina diaria compartida con horarios, para que nadie le dé de comer al perro dos veces. Veterinario y vacunas, con recordatorio antes de la siguiente.'),
    ('🎲','Juegos en familia','Retos de Ahorcado, Batalla Naval y un quiz con timbre — cada quien jugando en su propio teléfono.'),
    ('📣','Avisos','Un toque para "voy en camino" o "la cena está lista", y mira quién ya lo leyó. En iPhone, envíalo directo desde el widget de la pantalla de inicio.'),
    ('📍','Ubicación (iPhone)','Un mapa privado de la familia con ubicación en vivo y alertas de llegada y salida en los lugares que elijas. Apagado por defecto, visible solo para tu hogar.'),
    ('🗂️','Documentos','Identificaciones, seguros y registros guardados juntos, con vista previa de PDF — y bloqueo por rostro o huella con Plus.'),
    ('📺','Modo Casa','Convierte una tablet o laptop que no usas en la pantalla de inicio de la familia: agenda, listas, dinero y fotos de un vistazo.'),
    ('🧮','Utilidades','Divide la cuenta (por artículo desde una foto, con Plus), compara precios por unidad, calcula descuentos, imprime etiquetas de equipaje y ten un portarretratos familiar.'),
    ('👪','Perfiles de la familia','Los datos de cada quien en una tarjeta: cumpleaños, teléfono, tallas de ropa y calzado, tipo de sangre.'),
  ],
  vs_h2='¿Usando Cozi, TimeTree, AnyList y Life360 al mismo tiempo?',
  vs_sub='La mayoría de los hogares termina con una app para el calendario, otra para el súper, otra para la ubicación y una hoja de cálculo para el dinero. One Roof lo junta todo bajo un mismo techo — una invitación para todos, un plan por hogar.',
  vs_head=('Lo que tu familia necesita','Lo que mucha gente usa','En One Roof'),
  vs_rows=[
    ('Calendario familiar compartido','Cozi, TimeTree, Google Calendar','Calendario con sincronización con Google (Plus)'),
    ('Lista de compras','AnyList, OurGroceries, una app de notas','Listas por tienda, en vivo en todos los teléfonos'),
    ('Ubicación de la familia','Life360, Encontrar','Ubicación (iPhone, opcional)'),
    ('Presupuesto del hogar','Una hoja de cálculo o una app de finanzas','Dinero, con lectura de recibos'),
    ('Centro de la familia','FamilyWall, un grupo de WhatsApp','Todo eso, más mascotas, documentos y Roof'),
  ],
  vs_note='Cozi, TimeTree, AnyList, OurGroceries, Life360, Encontrar, FamilyWall, Google Calendar y WhatsApp son marcas de sus respectivos dueños. One Roof no está afiliado ni respaldado por ellos.',
  privacy_h2='Los datos de tu familia no son el producto',
  privacy_p='<strong>Sin anuncios. Sin rastreo. No vendemos tus datos.</strong> La información de cada hogar está aislada en la base de datos, visible solo para sus miembros.',
  faq_h2='Preguntas frecuentes',
  faq=[
    ('¿Qué es One Roof?','One Roof es una app para organizar la familia que reúne el calendario compartido, la lista de compras, el presupuesto, el cuidado de las mascotas, los documentos y los avisos del día a día del hogar en un solo lugar. Todos en casa ven la misma información, sincronizada, en iPhone y Android.'),
    ('¿One Roof es gratis?','Sí, One Roof es gratis para descargar y usar, y cada hogar nuevo recibe 30 días de One Roof Plus incluidos, sin tarjeta. Después, en el plan gratis, algunas funciones tienen límite de uso, como las peticiones a Roof y la lectura de recibos. One Roof Plus es una suscripción opcional que quita esos límites y agrega sincronización con Google Calendar, varios presupuestos y más — y una suscripción cubre todo el hogar, nunca por persona.'),
    ('¿One Roof es una buena alternativa a Cozi, TimeTree o FamilyWall?','Si quieres un calendario familiar compartido junto con lista de compras, presupuesto del hogar, cuidado de mascotas y mapa de la familia, One Roof junta en una sola app lo que muchas familias reparten entre Cozi o TimeTree (calendario), AnyList (súper) y Life360 (ubicación).'),
    ('¿One Roof funciona en Android?','Sí. One Roof está en la App Store y en Google Play. Algunas funciones por ahora son solo de iPhone: Ubicación (el mapa de la familia), widgets de la pantalla de inicio y sincronización con el Calendario de Apple.'),
    ('¿Puedo compartir el presupuesto con mi pareja?','Sí. Los presupuestos se comparten con todos en casa, por mes, semana o día, con categorías que ustedes controlan. Plus también permite presupuestos privados que solo tú ves.'),
    ('¿La lista de compras se sincroniza entre teléfonos?','Sí. Los artículos aparecen en el teléfono de todos en cuanto se agregan, organizados por tienda. Puedes agregar sin señal y los cambios se suben al volver la conexión.'),
    ('¿Qué es Roof?','Roof es el asistente de voz de One Roof. Di "Oye Casa" y pide con tus palabras agregar a la lista, registrar un gasto, ver o mover eventos del calendario o mandar un aviso a la familia. Muestra qué cambió y te deja deshacerlo.'),
    ('¿Qué es el Modo Casa?','El Modo Casa convierte una tablet, laptop o el navegador de la TV en una pantalla de inicio familiar con agenda, listas, dinero y fotos. Se vincula desde la app en segundos.'),
    ('¿Los datos de mi familia son privados?','Sí. One Roof no tiene anuncios ni rastreo y no vende datos. La información de cada hogar está aislada en la base de datos y solo sus miembros la ven.'),
    ('¿En qué idiomas está One Roof?','Español, portugués e inglés.'),
  ],
  story_h2='Por qué lo creamos',
  story_p='Un cuaderno de papel en la barra de la cocina para el súper. Correos del veterinario y recibos del banco como expediente de los perros. "¿Ya les diste de comer a los perros?" dos veces al día. One Roof reemplazó todo eso — hecho por un desarrollador móvil en Tampa, Florida, primero para su propio hogar (él, su esposa y sus dos perros), y compartido cuando de verdad funcionó.',
  footer='One Roof · hecho con ❤️ en Tampa, FL',
  privacy_link='Privacidad', support_link='Soporte',
)

LANGS = [EN, PT, ES]

# ---- v2 layout additions (same facts as above, re-cut for the new sections) ----
# show: one entry per showcase row = features[0..4] -> (lead, [points]); roof's
# points are things you say. alts: alt text per phone screenshot.
EN.update(
  nav=('Features', 'Compare', 'FAQ'), nav_cta='Get the app',
  pill='Family organizer app · iPhone & Android',
  h1_html='The family organizer app for <em>everything your household shares</em>',
  facts=[('Price', 'Free · optional Plus, one plan per household'), ('Works on', 'iPhone and Android'),
         ('Languages', 'English, Spanish, Portuguese'), ('Privacy', 'No ads, no tracking')],
  facts_label='One Roof at a glance',
  show=[
    ('One calendar the whole family can see.', ['Day, week and month views, color-coded by person', 'Birthdays, anniversaries and reminders', 'Syncs with Apple Calendar on iPhone, and two-way with Google Calendar on Plus']),
    ('Add an item and it appears on everyone\'s phone.', ['Groceries organized by store, plus chores, a trip, school', 'Live on every phone in the household', 'Keep adding with no signal; it syncs when you\'re back online']),
    ('Know what came in, what went out and where it went.', ['Shared budgets by month, week or day', 'Categories you control', 'Photograph a receipt: amount, date and category fill themselves in']),
    ('Say "Hey Roof" and ask in your own words. Roof does it and shows what changed, with Undo.', ['"Milk and eggs on the list"', '"I spent 50 at the supermarket"', '"What\'s on tomorrow?"']),
    ('A shared daily routine, so nobody feeds the dog twice.', ['Daily routine with times, checked off once for everyone', 'Vet visits and vaccines in one history', 'A reminder before the next one is due']),
  ],
  alts=dict(hero='One Roof home screen: today\'s family agenda and the household\'s apps', calendar='Shared family calendar in One Roof, week view', lists='Shared shopping list in One Roof, organized by store', money='Household budget in One Roof with spending by category', roof='Roof, the One Roof voice assistant, adding three items to the Walmart list', pets='Pet care in One Roof: daily routine, vet visits and vaccines', snap1='A small white dog sitting on the grass next to a tennis ball', snap2='The same dog on a beach towel by the water', casa='Modo Casa on a tablet standing on the kitchen table: today\'s calendar, lists and pets in light mode'),
  more_h2='And the rest of family life', more_sub='Smaller things that used to live in group chats, drawers and screenshots.',
  casa_eyebrow='For the kitchen, the hallway, the TV',
  how_h2='How One Roof works',
  how=[('Download One Roof', 'Free on the App Store and Google Play.'), ('Create your household', 'Your calendar, lists and budget start there.'), ('Invite your family', 'One invite for everyone. They see the same calendar, lists and budget, in sync.')],
  privacy_chips=['No ads', 'No tracking', 'We don\'t sell your data'],
  privacy_text='Each household\'s information is walled off inside the database, visible to its members and nobody else.',
  cta_h2='Bring the whole house under one roof',
)
PT.update(
  nav=('Recursos', 'Comparar', 'Dúvidas'), nav_cta='Baixar o app',
  pill='App para organizar a família · iPhone e Android',
  h1_html='O app para organizar a família e <em>tudo o que a casa compartilha</em>',
  facts=[('Preço', 'Grátis · Plus opcional, um plano por casa'), ('Funciona em', 'iPhone e Android'),
         ('Idiomas', 'Português, espanhol e inglês'), ('Privacidade', 'Sem anúncios, sem rastreamento')],
  facts_label='O One Roof em resumo',
  show=[
    ('Uma agenda que a família inteira vê.', ['Visões de dia, semana e mês, com cor por pessoa', 'Aniversários, datas especiais e lembretes', 'Sincroniza com o Calendário da Apple no iPhone e, no Plus, nos dois sentidos com o Google Agenda']),
    ('Adicione um item e ele aparece no celular de todos.', ['Mercado organizado por loja, mais tarefas, uma viagem, a escola', 'Ao vivo em todos os celulares da casa', 'Dá para adicionar sem sinal; sincroniza quando a conexão volta']),
    ('Saiba o que entrou, o que saiu e para onde foi.', ['Orçamentos compartilhados por mês, semana ou dia', 'Categorias que vocês controlam', 'Fotografe um recibo: valor, data e categoria se preenchem sozinhos']),
    ('Diga "Oi Casa" e peça com as suas palavras. O Roof faz e mostra o que mudou, com Desfazer.', ['"Leite e ovos na lista"', '"Gastei 50 no mercado"', '"O que temos amanhã?"']),
    ('Uma rotina diária compartilhada, para ninguém dar comida ao cachorro duas vezes.', ['Rotina diária com horários, marcada uma vez para todos', 'Veterinário e vacinas num histórico só', 'Lembrete antes da próxima']),
  ],
  alts=dict(hero='Tela inicial do One Roof: a agenda da família de hoje e os apps da casa', calendar='Agenda familiar compartilhada no One Roof', lists='Lista de compras compartilhada no One Roof, organizada por loja', money='Orçamento da casa no One Roof', roof='Roof, o assistente de voz do One Roof, respondendo sobre a rotina do pet', pets='Cuidados com os pets no One Roof: rotina diária, veterinário e vacinas', snap1='Uma cachorrinha branca sentada na grama ao lado de uma bolinha de tênis', snap2='A mesma cachorrinha numa canga na praia, perto da água', casa='Modo Casa num tablet em cima da mesa: agenda de hoje, listas e pets no modo claro'),
  more_h2='E o resto da vida em família', more_sub='Coisas menores que antes ficavam em grupos de mensagem, gavetas e capturas de tela.',
  casa_eyebrow='Para a cozinha, o corredor, a TV',
  how_h2='Como o One Roof funciona',
  how=[('Baixe o One Roof', 'Grátis na App Store e no Google Play.'), ('Crie a sua casa', 'A agenda, as listas e o orçamento começam ali.'), ('Convide a família', 'Um convite para todos. Eles veem a mesma agenda, as mesmas listas e o mesmo orçamento, sincronizados.')],
  privacy_chips=['Sem anúncios', 'Sem rastreamento', 'Não vendemos seus dados'],
  privacy_text='As informações de cada casa ficam isoladas no banco de dados, visíveis só para os membros dela.',
  cta_h2='Coloque a casa inteira debaixo do mesmo teto',
)
ES.update(
  nav=('Funciones', 'Comparar', 'Preguntas'), nav_cta='Descargar',
  pill='App para organizar la familia · iPhone y Android',
  h1_html='La app para organizar la familia y <em>todo lo que comparte tu hogar</em>',
  facts=[('Precio', 'Gratis · Plus opcional, un plan por hogar'), ('Funciona en', 'iPhone y Android'),
         ('Idiomas', 'Español, portugués e inglés'), ('Privacidad', 'Sin anuncios, sin rastreo')],
  facts_label='One Roof en resumen',
  show=[
    ('Un calendario que ve toda la familia.', ['Vistas de día, semana y mes, con color por persona', 'Cumpleaños, aniversarios y recordatorios', 'Sincroniza con el Calendario de Apple en iPhone y, con Plus, en ambos sentidos con Google Calendar']),
    ('Agrega un artículo y aparece en el teléfono de todos.', ['El súper organizado por tienda, más tareas, un viaje, la escuela', 'En vivo en todos los teléfonos del hogar', 'Puedes agregar sin señal; se sincroniza al volver la conexión']),
    ('Sabe qué entró, qué salió y a dónde se fue.', ['Presupuestos compartidos por mes, semana o día', 'Categorías que ustedes controlan', 'Fotografía un recibo: monto, fecha y categoría se llenan solos']),
    ('Di "Oye Casa" y pide con tus palabras. Roof lo hace y muestra qué cambió, con Deshacer.', ['"Leche y huevos a la lista"', '"Gasté 50 en el súper"', '"¿Qué hay mañana?"']),
    ('Una rutina diaria compartida, para que nadie le dé de comer al perro dos veces.', ['Rutina diaria con horarios, marcada una vez para todos', 'Veterinario y vacunas en un solo historial', 'Recordatorio antes de la siguiente']),
  ],
  alts=dict(hero='Pantalla de inicio de One Roof: la agenda familiar de hoy y las apps del hogar', calendar='Calendario familiar compartido en One Roof', lists='Lista de compras compartida en One Roof, organizada por tienda', money='Presupuesto del hogar en One Roof', roof='Roof, el asistente de voz de One Roof, respondiendo sobre la rutina de la mascota', pets='Cuidado de mascotas en One Roof: rutina diaria, veterinario y vacunas', snap1='Una perrita blanca sentada en el pasto junto a una pelota de tenis', snap2='La misma perrita sobre una toalla en la playa, junto al agua', casa='Modo Casa en una tablet sobre la mesa: agenda de hoy, listas y mascotas en modo claro'),
  more_h2='Y el resto de la vida en familia', more_sub='Cosas más pequeñas que antes vivían en chats de grupo, cajones y capturas de pantalla.',
  casa_eyebrow='Para la cocina, el pasillo, la TV',
  how_h2='Cómo funciona One Roof',
  how=[('Descarga One Roof', 'Gratis en la App Store y en Google Play.'), ('Crea tu hogar', 'El calendario, las listas y el presupuesto empiezan ahí.'), ('Invita a tu familia', 'Una invitación para todos. Ven el mismo calendario, las mismas listas y el mismo presupuesto, sincronizados.')],
  privacy_chips=['Sin anuncios', 'Sin rastreo', 'No vendemos tus datos'],
  privacy_text='La información de cada hogar está aislada en la base de datos, visible solo para sus miembros.',
  cta_h2='Pon toda la casa bajo un mismo techo',
)

# ---- AI emphasis (receipt scan, Roof, bill split). Wording from the store listing:
# "AI assistant", "AI receipt and bill scans", split by item from a photo on Plus.
EN.update(ai='AI',
  scan=('Scan a receipt, skip the typing', 'Photograph a receipt and AI reads it for you: the amount, date and category fill themselves in.'),
  scan_fields=['Amount', 'Date', 'Category'], scan_alt='A receipt being scanned',
  ai_h2='AI that does the typing for you', ai_sub='One Roof uses AI where it saves real effort, not as decoration.',
  ai_cards=[('🎙️', 'Roof, the AI assistant', 'Ask in your own words. Roof adds to the list, logs an expense or checks the calendar, then shows what changed, with Undo.'),
            ('🧾', 'AI receipt scan', 'Photograph a receipt and the amount, date and category fill themselves in.'),
            ('🍽️', 'Split a bill from a photo', 'Snap the bill and AI splits it by item. On Plus.')])
EN['faq'].insert(7, ('Does One Roof use AI?', 'Yes. Roof, the voice assistant, understands requests in your own words and does them for you. In Money, you photograph a receipt and AI fills in the amount, date and category. On Plus, a bill can also be split by item from a photo.'))
PT.update(ai='IA',
  scan=('Escaneie o recibo e pule a digitação', 'Fotografe um recibo e a IA lê para você: o valor, a data e a categoria se preenchem sozinhos.'),
  scan_fields=['Valor', 'Data', 'Categoria'], scan_alt='Um recibo sendo escaneado',
  ai_h2='IA que digita por você', ai_sub='O One Roof usa IA onde ela poupa trabalho de verdade, não como enfeite.',
  ai_cards=[('🎙️', 'Roof, o assistente com IA', 'Peça com as suas palavras. O Roof adiciona à lista, lança um gasto ou consulta a agenda, e mostra o que mudou, com Desfazer.'),
            ('🧾', 'Leitura de recibo com IA', 'Fotografe um recibo e o valor, a data e a categoria se preenchem sozinhos.'),
            ('🍽️', 'Divida a conta por foto', 'Tire uma foto da conta e a IA divide por item. No Plus.')])
PT['faq'].insert(7, ('O One Roof usa IA?', 'Sim. O Roof, o assistente de voz, entende pedidos com as suas palavras e faz por você. No Dinheiro, você fotografa um recibo e a IA preenche o valor, a data e a categoria. No Plus, também dá para dividir uma conta por item a partir de uma foto.'))
ES.update(ai='IA',
  scan=('Escanea el recibo y olvídate de teclear', 'Fotografía un recibo y la IA lo lee por ti: el monto, la fecha y la categoría se llenan solos.'),
  scan_fields=['Monto', 'Fecha', 'Categoría'], scan_alt='Un recibo siendo escaneado',
  ai_h2='IA que escribe por ti', ai_sub='One Roof usa IA donde ahorra trabajo de verdad, no como adorno.',
  ai_cards=[('🎙️', 'Roof, el asistente con IA', 'Pide con tus palabras. Roof agrega a la lista, registra un gasto o consulta el calendario, y muestra qué cambió, con Deshacer.'),
            ('🧾', 'Lectura de recibos con IA', 'Fotografía un recibo y el monto, la fecha y la categoría se llenan solos.'),
            ('🍽️', 'Divide la cuenta con una foto', 'Toma una foto de la cuenta y la IA la divide por artículo. Con Plus.')])
ES['faq'].insert(7, ('¿One Roof usa IA?', 'Sí. Roof, el asistente de voz, entiende peticiones con tus palabras y las hace por ti. En Dinero, fotografías un recibo y la IA llena el monto, la fecha y la categoría. Con Plus, también puedes dividir una cuenta por artículo desde una foto.'))

# ---- Receipt-scan art in the budget row: same drawing and sample data as the
# store's receipt slide (mobile/store/app-store-v4/copy.js).
EN.update(rcpt=dict(merchant='Corner Market', date='11/14 · 10:42', total='54.46', dec='.',
  items=['Strawberries', 'Sourdough bread', 'Dog treats', 'Ice cream', 'Bananas', 'Ground coffee'],
  filled='Filled in for you', amount='$54.46', rows=[('Category', '🛒 Groceries'), ('Date', 'Nov 14')]))
PT.update(rcpt=dict(merchant='Corner Market', date='14/11 · 10:42', total='54,46', dec=',',
  items=['Morangos', 'Pão de fermentação', 'Petisco de cachorro', 'Sorvete', 'Bananas', 'Café moído'],
  filled='Preenchido para você', amount='R$ 54,46', rows=[('Categoria', '🛒 Mercado'), ('Data', '14/11')]))
ES.update(rcpt=dict(merchant='Corner Market', date='14/11 · 10:42', total='54.46', dec='.',
  items=['Fresas', 'Pan de masa madre', 'Premios para perro', 'Helado', 'Plátanos', 'Café molido'],
  filled='Llenado por ti', amount='$54.46', rows=[('Categoría', '🛒 Súper'), ('Fecha', '14/11')]))

# ---- Row art (floating cards over each phone) + two more rows: games and
# hand-drawn notes. Card wording is the store slides' (app-store-v4/copy.js) and
# the app's own strings (notes.* in mobile/src/lib/i18n).
EN['features'].append(('✏️', 'Hand-drawn notes', 'Write or draw a note with your finger and send it to one person or the whole family. The ones you keep stay on your wall.'))
EN['show'] += [
  ('Game night, on every phone.', ['Hangman: guess the word before the house is finished', 'Battleship, team vs team', 'A buzzer quiz for the whole family']),
  ('Write or draw with your finger and send it to the family.', ['Pick a pen color and thickness', 'Send to one person or to everyone', 'Notes you keep stay on your wall']),
]
EN['alts'].update(games='Family games in One Roof: Hangman, Battleship and a buzzer quiz', notes='A hand-drawn note that says: Back by 7')
EN.update(art=dict(
  views=['Day', 'Week', 'Month'], sync=('Two-way sync', 'Google & Apple Calendar'), event=('Vet checkup · Lola', 'Today · 4:30 PM'),
  kinds='Groceries · Chores · Trips · School', added=('S', 'Sam added to Chores', 'Fold the laundry', 'just now'),
  ask=['"Move the dentist to Monday"', '"Tell everyone dinner\'s ready"'], talk=('Talk or type', 'in your own words'),
  games=['Hangman challenges', 'Battleship, team vs team', 'Buzzer quiz'],
  note='Back by 7!', push=('Sam drew you a note ✏️', 'Tap to see it'), sendall='Send to everyone'))
PT['features'].append(('✏️', 'Recados à mão', 'Escreva ou desenhe um recado com o dedo e mande para uma pessoa ou para a família toda. Os que você guarda ficam no seu mural.'))
PT['show'] += [
  ('Noite de jogos, em cada celular.', ['Forca: adivinhe a palavra antes de a casa ficar pronta', 'Batalha Naval em times', 'Um quiz com campainha para a família toda']),
  ('Escreva ou desenhe com o dedo e mande para a família.', ['Escolha a cor e a espessura da caneta', 'Envie para uma pessoa ou para todos', 'Os recados que você guarda ficam no seu mural']),
]
PT['alts'].update(games='Jogos em família no One Roof: Forca, Batalha Naval e quiz com campainha', notes='Um recado escrito à mão que diz: Volto às 7')
PT.update(art=dict(
  views=['Dia', 'Semana', 'Mês'], sync=('Sincroniza nos dois sentidos', 'Google e Apple Calendar'), event=('Veterinário · Lola', 'Hoje · 16:30'),
  kinds='Mercado · Tarefas · Viagens · Escola', added=('S', 'Sam adicionou em Tarefas', 'Dobrar a roupa', 'agora'),
  ask=['"Muda o dentista pra segunda"', '"Avisa que o jantar está pronto"'], talk=('Fale ou digite', 'do seu jeito'),
  games=['Desafios de Forca', 'Batalha naval em times', 'Perguntas & Tortadas'],
  note='Volto às 7!', push=('Sam desenhou um recado ✏️', 'Toque para ver'), sendall='Enviar para todos'))
ES['features'].append(('✏️', 'Notas a mano', 'Escribe o dibuja una nota con el dedo y envíala a una persona o a toda la familia. Las que guardas se quedan en tu mural.'))
ES['show'] += [
  ('Noche de juegos, en cada teléfono.', ['Ahorcado: adivina la palabra antes de que la casa quede lista', 'Batalla Naval por equipos', 'Un quiz con timbre para toda la familia']),
  ('Escribe o dibuja con el dedo y envíala a la familia.', ['Elige el color y el grosor del lápiz', 'Envíala a una persona o a todos', 'Las notas que guardas se quedan en tu mural']),
]
ES['alts'].update(games='Juegos en familia en One Roof: Ahorcado, Batalla Naval y quiz con timbre', notes='Una nota escrita a mano que dice: Vuelvo a las 7')
ES.update(art=dict(
  views=['Día', 'Semana', 'Mes'], sync=('Sincroniza en ambos sentidos', 'Google y Apple Calendar'), event=('Veterinario · Lola', 'Hoy · 16:30'),
  kinds='Súper · Tareas · Viajes · Escuela', added=('S', 'Sam añadió a Tareas', 'Doblar la ropa', 'ahora'),
  ask=['"Mueve el dentista al lunes"', '"Avisa que la cena está lista"'], talk=('Habla o escribe', 'con tus palabras'),
  games=['Retos de Ahorcado', 'Batalla naval por equipos', 'Preguntas con pulsador'],
  note='¡Vuelvo a las 7!', push=('Sam te dibujó una nota ✏️', 'Toca para verla'), sendall='Enviar a todos'))

# ---- Roof carousel: three example requests per app, read straight from the
# app's own strings (roofEx.* in mobile/src/lib/i18n) by build.py. Labels only here.
ROOF_GROUPS = [('shop', (1, 3, 5)), ('cal', (1, 3, 4)), ('money', (1, 2, 6)), ('pets', (1, 2, 4)),
               ('family', (1, 2, 3)), ('docs', (1, 2, 3)), ('nudge', (1, 2)), ('calc', (1, 3, 4))]
EN.update(i18n='en', roof_labels=['🛒 Lists', '📅 Calendar', '💰 Money', '🐾 Pets', '👪 Family', '🗂️ Documents', '📣 Nudges', '🧮 Utilities'], roof_aria='Things you can ask Roof')
PT.update(i18n='pt', roof_labels=['🛒 Listas', '📅 Agenda', '💰 Dinheiro', '🐾 Pets', '👪 Família', '🗂️ Documentos', '📣 Avisos', '🧮 Utilidades'], roof_aria='Coisas que você pode pedir ao Roof')
ES.update(i18n='es', roof_labels=['🛒 Listas', '📅 Calendario', '💰 Dinero', '🐾 Mascotas', '👪 Familia', '🗂️ Documentos', '📣 Avisos', '🧮 Utilidades'], roof_aria='Cosas que puedes pedirle a Roof')
EN['art']['view_on'] = 1; PT['art']['view_on'] = 2; ES['art']['view_on'] = 2

# ---- English calls it "Home Mode" (owner, 2026-11-16; matches the app's settings
# screen). PT/ES keep "Modo Casa". Applied in place so every EN string follows.
def _rename(x):
    if isinstance(x, str): return x.replace('Modo Casa', 'Home Mode')
    if isinstance(x, dict): return {k: _rename(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)): return type(x)(_rename(v) for v in x)
    return x
for _k in list(EN): EN[_k] = _rename(EN[_k])

# ---- 2026-11-16: Android now has Home Screen widgets too (Play "What's new":
# Today, Nudges, Money, Pet care, Note, Lists; iOS has Today, Nudges, Pet care,
# Note, Lists) -> widgets are no longer iPhone-only. Whereabouts and Apple
# Calendar sync still are. Plus the richer "rest of family life" cards (bento).
def _set_feature(L, i, desc): L['features'][i] = (L['features'][i][0], L['features'][i][1], desc)
def _set_faq(L, i, q, a): L['faq'][i] = (q, a)
_set_feature(EN, 6, 'One tap for "on my way" or "dinner\'s ready", and see who has read it. An urgent nudge carries a call button, and you can send one straight from the Home Screen widget.')
_set_feature(PT, 6, 'Um toque para "tô indo" ou "comida pronta", e veja quem já leu. Um aviso urgente vem com botão de ligar, e dá para enviar direto do widget da tela de início.')
_set_feature(ES, 6, 'Un toque para "voy en camino" o "la comida está lista", y mira quién ya lo leyó. Un aviso urgente trae botón de llamar, y puedes enviarlo directo desde el widget de la pantalla de inicio.')
EN['features'].append(('📱', 'Home Screen widgets', 'Today, Nudges, Pet care, Notes and Lists on your Home Screen, on iPhone and Android.'))
PT['features'].append(('📱', 'Widgets na tela de início', 'Hoje, Avisos, Pets, Recados e Listas na tela de início, no iPhone e no Android.'))
ES['features'].append(('📱', 'Widgets en la pantalla de inicio', 'Hoy, Avisos, Mascotas, Notas y Listas en la pantalla de inicio, en iPhone y Android.'))
_set_faq(EN, 2, 'Is One Roof a good alternative to Cozi, TimeTree or FamilyWall?', 'Yes. One Roof does in a single app the main things families use those apps for: a shared family calendar (Cozi, TimeTree), grocery and shopping lists (AnyList), a family map (Life360) and a household budget, plus pet care, documents and Roof, a voice assistant. It is free to download and use, one optional subscription covers the whole household instead of charging per person, and there is no extra device to buy: Home Mode runs on any tablet, laptop or TV browser you already have.')
_set_faq(PT, 2, 'O One Roof é uma boa alternativa ao Cozi, TimeTree ou FamilyWall?', 'Sim. O One Roof faz num app só as principais coisas para as quais as famílias usam esses apps: agenda familiar compartilhada (Cozi, TimeTree), lista de compras (AnyList), mapa da família (Life360) e orçamento da casa, mais cuidados com pets, documentos e o Roof, um assistente de voz. É grátis para baixar e usar, uma assinatura opcional cobre a casa inteira em vez de cobrar por pessoa, e não precisa comprar nenhum aparelho: o Modo Casa roda em qualquer tablet, notebook ou navegador de TV que você já tem.')
_set_faq(ES, 2, '¿One Roof es una buena alternativa a Cozi, TimeTree o FamilyWall?', 'Sí. One Roof hace en una sola app lo principal para lo que las familias usan esas apps: calendario familiar compartido (Cozi, TimeTree), lista de compras (AnyList), mapa de la familia (Life360) y presupuesto del hogar, más cuidado de mascotas, documentos y Roof, un asistente de voz. Es gratis para descargar y usar, una suscripción opcional cubre todo el hogar en lugar de cobrar por persona, y no hay que comprar ningún aparato: el Modo Casa funciona en cualquier tablet, laptop o navegador de TV que ya tengas.')
_set_faq(EN, 3, 'Does One Roof work on Android?', 'Yes. One Roof is on the App Store and Google Play, with Home Screen widgets on both. Two features are iPhone-only for now: Whereabouts (the family map) and Apple Calendar sync.')
_set_faq(PT, 3, 'O One Roof funciona no Android?', 'Sim. O One Roof está na App Store e no Google Play, com widgets da tela de início nos dois. Dois recursos ainda são só do iPhone: Localização (o mapa da família) e a sincronização com o Calendário da Apple.')
_set_faq(ES, 3, '¿One Roof funciona en Android?', 'Sí. One Roof está en la App Store y en Google Play, con widgets de la pantalla de inicio en ambos. Dos funciones por ahora son solo de iPhone: Ubicación (el mapa de la familia) y la sincronización con el Calendario de Apple.')
# bento: (feature index, key, tint, lead, [points]); art strings in `b`.
EN.update(bento=[
  (6, 'nudges', '#ef5a6f', 'One tap says it. Everyone sees it.', ['Quick messages, or write your own', 'See who has read it', 'An urgent nudge carries a call button', 'Send one from the Home Screen widget']),
  (7, 'map', '#2d8fe0', 'A private family map, only for your household.', ['Live locations, off by default', 'Arrive and leave alerts for the places you choose', 'A safety radius for outings']),
  (8, 'docs', '#7a8699', 'IDs, insurance and registrations, kept together.', ['Scan with the camera or upload a file', 'PDF previews', 'Face or fingerprint lock on Plus', 'Ask Roof: "Open Sam\'s passport"']),
  (10, 'tools', '#1fa873', 'Small tools for the everyday math.', ['Split a bill evenly, or by item from a photo (Plus)', 'Compare unit prices and work out a discount', 'Print luggage tags', 'Turn a spare tablet into a family photo frame']),
  (11, 'family', '#f0a020', 'Everyone\'s details on one card.', ['Birthdays and phone numbers', 'Clothing and shoe sizes', 'Blood types and allergies']),
  (13, 'widgets', '#6d63f5', 'The day at a glance, without opening the app.', ['Today, Nudges, Pet care, Notes and Lists', 'On iPhone and Android']),
], b=dict(seen='seen by Sam', alerts='Arrive & leave alerts', off='Off by default', docs=['Passport', 'Car insurance', 'Driver\'s license'], lock='Locked · Plus',
  vals=['Mar 12', '9', 'O+'], today='Today', pets='Pet care', ev=['Vet checkup', 'Soccer practice'], care=['Breakfast', 'Dinner']))
PT.update(bento=[
  (6, 'nudges', '#ef5a6f', 'Um toque avisa. Todo mundo vê.', ['Avisos rápidos, ou escreva o seu', 'Veja quem já leu', 'Um aviso urgente vem com botão de ligar', 'Envie direto do widget da tela de início']),
  (7, 'map', '#2d8fe0', 'Um mapa privado da família, só para a sua casa.', ['Localização ao vivo, desligada por padrão', 'Alertas de chegada e saída nos lugares que você escolher', 'Raio de segurança para passeios']),
  (8, 'docs', '#7a8699', 'RG, seguros e registros guardados juntos.', ['Escaneie com a câmera ou envie um arquivo', 'Prévia de PDF', 'Trava por rosto ou digital no Plus', 'Peça ao Roof: "Abre o passaporte do Sam"']),
  (10, 'tools', '#1fa873', 'Pequenas ferramentas para as contas do dia a dia.', ['Divida a conta por igual, ou por item a partir de uma foto (Plus)', 'Compare preços por unidade e calcule descontos', 'Imprima etiquetas de bagagem', 'Transforme um tablet parado num porta-retrato da família']),
  (11, 'family', '#f0a020', 'Os dados de cada um num cartão.', ['Aniversários e telefones', 'Tamanhos de roupa e calçado', 'Tipo sanguíneo e alergias']),
  (13, 'widgets', '#6d63f5', 'O dia num relance, sem abrir o app.', ['Hoje, Avisos, Pets, Recados e Listas', 'No iPhone e no Android']),
], b=dict(seen='visto por Sam', alerts='Alertas de chegada e saída', off='Desligado por padrão', docs=['Passaporte', 'Seguro do carro', 'CNH'], lock='Com trava · Plus',
  vals=['12 mar', '38', 'O+'], today='Hoje', pets='Pets', ev=['Veterinário', 'Treino de futebol'], care=['Café da manhã', 'Jantar']))
ES.update(bento=[
  (6, 'nudges', '#ef5a6f', 'Un toque lo dice. Todos lo ven.', ['Avisos rápidos, o escribe el tuyo', 'Mira quién ya lo leyó', 'Un aviso urgente trae botón de llamar', 'Envíalo desde el widget de la pantalla de inicio']),
  (7, 'map', '#2d8fe0', 'Un mapa privado de la familia, solo para tu hogar.', ['Ubicación en vivo, apagada por defecto', 'Alertas de llegada y salida en los lugares que elijas', 'Radio de seguridad para las salidas']),
  (8, 'docs', '#7a8699', 'Identificaciones, seguros y registros, guardados juntos.', ['Escanea con la cámara o sube un archivo', 'Vista previa de PDF', 'Bloqueo por rostro o huella con Plus', 'Pídele a Roof: "Abre el pasaporte de Sam"']),
  (10, 'tools', '#1fa873', 'Pequeñas herramientas para las cuentas del día a día.', ['Divide la cuenta en partes iguales, o por artículo desde una foto (Plus)', 'Compara precios por unidad y calcula descuentos', 'Imprime etiquetas de equipaje', 'Convierte una tablet que no usas en un portarretratos familiar']),
  (11, 'family', '#f0a020', 'Los datos de cada quien en una tarjeta.', ['Cumpleaños y teléfonos', 'Tallas de ropa y calzado', 'Tipo de sangre y alergias']),
  (13, 'widgets', '#6d63f5', 'El día de un vistazo, sin abrir la app.', ['Hoy, Avisos, Mascotas, Notas y Listas', 'En iPhone y Android']),
], b=dict(seen='visto por Sam', alerts='Alertas de llegada y salida', off='Apagado por defecto', docs=['Pasaporte', 'Seguro del auto', 'Licencia de conducir'], lock='Con bloqueo · Plus',
  vals=['12 mar', '38', 'O+'], today='Hoy', pets='Mascotas', ev=['Veterinario', 'Práctica de fútbol'], care=['Desayuno', 'Cena']))
for _L, _n, _m in ((EN, 'Nudges on One Roof: quick messages for the family', 'Whereabouts on One Roof: the private family map'), (PT, 'Avisos no One Roof: recados rápidos para a família', 'Localização no One Roof: o mapa privado da família'), (ES, 'Avisos en One Roof: mensajes rápidos para la familia', 'Ubicación en One Roof: el mapa privado de la familia')):
    _L['alts'].update(nudges=_n, map=_m)

# ---- 2026-11-16 (owner's Google Trends, US, last year): "family app" is the big
# term (51 vs 4 for "family organizer"), and "skylight / skylight calendar" are
# rising related searches -> EN leads with "family app"; a Skylight row + FAQ
# point at Home Mode (no device to buy). The seal says what we aim for; it is
# our own line, not an award.
EN.update(
  title='One Roof — The Family App: Shared Calendar, Lists & Budget',
  description='One Roof is the family app and organizer for your whole household: shared calendar, shopping lists, budget, pet care and Roof, a voice assistant. Free on iPhone and Android.',
  og_title='One Roof — the family app for everything your household shares',
  h1='The family app for everything your household shares',
  h1_html='The family app for <em>everything your household shares</em>',
  pill='Family app & organizer · iPhone & Android',
  seal='MADE TO BE THE BEST FAMILY APP · ', seal_alt='One Roof: made to be the best family app')
PT.update(seal='FEITO PARA SER O MELHOR APP DE FAMÍLIA · ', seal_alt='One Roof: feito para ser o melhor app de família')
ES.update(seal='HECHA PARA SER LA MEJOR APP FAMILIAR · ', seal_alt='One Roof: hecha para ser la mejor app familiar')
EN['vs_rows'].insert(4, ('Family calendar on a screen at home', 'Skylight Calendar, a paper wall calendar', 'Home Mode on any tablet, laptop or TV you already own'))
PT['vs_rows'].insert(4, ('Agenda da família numa tela em casa', 'Skylight Calendar, calendário de parede', 'Modo Casa em qualquer tablet, notebook ou TV que você já tem'))
ES['vs_rows'].insert(4, ('Calendario familiar en una pantalla en casa', 'Skylight Calendar, un calendario de pared', 'Modo Casa en cualquier tablet, laptop o TV que ya tengas'))
EN['vs_note'] = EN['vs_note'].replace('FamilyWall and Google Calendar are', 'FamilyWall, Skylight and Google Calendar are')
PT['vs_note'] = PT['vs_note'].replace('FamilyWall, ', 'FamilyWall, Skylight, ')
ES['vs_note'] = ES['vs_note'].replace('FamilyWall, ', 'FamilyWall, Skylight, ')
assert all('Skylight' in L['vs_note'] for L in (EN, PT, ES))
EN['faq'].insert(3, ('Do I need to buy a device like a Skylight Calendar to have a family screen at home?', 'No. Home Mode turns a spare tablet, laptop or TV browser you already own into the family\'s home screen, with the agenda, lists, pets and photos. You pair it from the app in a few seconds.'))
PT['faq'].insert(3, ('Preciso comprar um aparelho como o Skylight Calendar para ter uma tela da família em casa?', 'Não. O Modo Casa transforma um tablet, notebook ou navegador de TV que você já tem na tela inicial da família, com agenda, listas, pets e fotos. Você pareia pelo app em poucos segundos.'))
ES['faq'].insert(3, ('¿Necesito comprar un aparato como el Skylight Calendar para tener una pantalla familiar en casa?', 'No. El Modo Casa convierte una tablet, laptop o navegador de TV que ya tienes en la pantalla de inicio de la familia, con agenda, listas, mascotas y fotos. Se vincula desde la app en segundos.'))
EN['faq'].insert(1, ('What is the best family app for a whole household?', 'The best family app is the one everyone at home actually opens. One Roof is made for that: one shared calendar, shopping lists, a household budget, pet care, documents, nudges and Roof, a voice assistant, in sync on every phone. It is free to download on iPhone and Android.'))
PT['faq'].insert(1, ('Qual é o melhor app de família para a casa inteira?', 'O melhor app de família é aquele que todo mundo em casa realmente abre. O One Roof é feito para isso: agenda compartilhada, lista de compras, orçamento da casa, cuidados com pets, documentos, avisos e o Roof, um assistente de voz, sincronizados em todos os celulares. É grátis para baixar no iPhone e no Android.'))
ES['faq'].insert(1, ('¿Cuál es la mejor app familiar para todo el hogar?', 'La mejor app familiar es la que todos en casa abren de verdad. One Roof está hecha para eso: calendario compartido, lista de compras, presupuesto del hogar, cuidado de mascotas, documentos, avisos y Roof, un asistente de voz, sincronizados en todos los teléfonos. Es gratis para descargar en iPhone y Android.'))
