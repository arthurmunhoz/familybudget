// Hangman word lists: the category is the hint, the words are suggestions (or
// the pool for "random word"). Family-friendly, everyday words a kid and a
// grandparent both know. Accents are kept — the server folds them, so guessing
// "A" also reveals "Ã".
//
// Category LABELS are i18n keys (games.cat.<id>); the words are per language.
import type { LucideIcon } from 'lucide-react-native'
import type { Gradient } from '@/components/home/palette'
import { Apple, Briefcase, Bus, Dog, Globe2, Home, Leaf, Trophy } from 'lucide-react-native'

export type CategoryId = 'animals' | 'food' | 'home' | 'jobs' | 'countries' | 'sports' | 'nature' | 'transport'

export const CATEGORIES: { id: CategoryId; icon: LucideIcon; tint: string; colors: Gradient }[] = [
  { id: 'animals', icon: Dog, tint: '#F2862A', colors: ['#FFB45C', '#F2862A'] },
  { id: 'food', icon: Apple, tint: '#E8506A', colors: ['#FF8A8A', '#E8506A'] },
  { id: 'home', icon: Home, tint: '#D9466F', colors: ['#F27BA8', '#C93D63'] },
  { id: 'jobs', icon: Briefcase, tint: '#7140D6', colors: ['#A57CF2', '#7140D6'] },
  { id: 'countries', icon: Globe2, tint: '#2563D9', colors: ['#5B9BFF', '#2563D9'] },
  { id: 'sports', icon: Trophy, tint: '#E0A100', colors: ['#FFCB4D', '#E39A00'] },
  { id: 'nature', icon: Leaf, tint: '#0FA37F', colors: ['#3FD3A0', '#0FA37F'] },
  { id: 'transport', icon: Bus, tint: '#127F86', colors: ['#3EC2C8', '#127F86'] },
]

type Lists = Record<CategoryId, string[]>

const pt: Lists = {
  animals: ['cachorro', 'gato', 'elefante', 'girafa', 'tartaruga', 'borboleta', 'jacaré', 'pinguim', 'papagaio', 'tubarão', 'coelho', 'cavalo', 'macaco', 'leão', 'baleia', 'formiga', 'coruja', 'golfinho', 'zebra', 'camelo', 'abelha', 'sapo', 'onça', 'tamanduá', 'hipopótamo', 'canguru', 'esquilo', 'galinha', 'vaca', 'porco', 'ovelha', 'raposa', 'lobo', 'urso', 'polvo', 'foca', 'camaleão', 'preguiça', 'arara', 'tucano'],
  food: ['feijoada', 'brigadeiro', 'pão de queijo', 'pipoca', 'macarrão', 'coxinha', 'abacaxi', 'melancia', 'chocolate', 'sorvete', 'hambúrguer', 'panqueca', 'tapioca', 'pastel', 'banana', 'morango', 'lasanha', 'cenoura', 'omelete', 'açaí', 'goiabada', 'requeijão', 'farofa', 'mandioca', 'bolo de cenoura', 'quindim', 'pudim', 'churrasco', 'arroz doce', 'beijinho', 'empada', 'moqueca', 'vatapá', 'paçoca', 'pamonha', 'cuscuz', 'salada', 'sanduíche', 'biscoito', 'geleia'],
  home: ['geladeira', 'travesseiro', 'cadeira', 'escova de dente', 'televisão', 'liquidificador', 'janela', 'chuveiro', 'sofá', 'tapete', 'espelho', 'vassoura', 'panela', 'cortina', 'lâmpada', 'gaveta', 'controle remoto', 'toalha', 'cobertor', 'relógio', 'fogão', 'armário', 'campainha', 'escada', 'ventilador', 'computador', 'microondas', 'torradeira', 'prateleira', 'escrivaninha', 'almofada', 'abajur', 'varal', 'ferro de passar', 'mangueira', 'tesoura', 'guarda-chuva', 'cabide', 'fechadura'],
  jobs: ['professora', 'bombeiro', 'médico', 'astronauta', 'cozinheiro', 'dentista', 'veterinária', 'piloto', 'jardineiro', 'carteiro', 'engenheiro', 'enfermeira', 'padeiro', 'fotógrafo', 'motorista', 'cientista', 'cantor', 'pintor', 'advogada', 'policial', 'mecânico', 'pescador', 'arquiteta', 'palhaço', 'bailarina', 'escritor', 'juiz', 'marceneiro', 'costureira', 'farmacêutico', 'garçom', 'agricultor', 'eletricista', 'encanador', 'salva-vidas', 'treinador', 'cabeleireiro', 'detetive', 'mágico', 'apresentador'],
  countries: ['brasil', 'argentina', 'japão', 'canadá', 'portugal', 'itália', 'méxico', 'egito', 'austrália', 'frança', 'alemanha', 'china', 'índia', 'chile', 'espanha', 'grécia', 'peru', 'estados unidos', 'rússia', 'noruega', 'marrocos', 'uruguai', 'colômbia', 'irlanda', 'holanda', 'suíça', 'suécia', 'turquia', 'tailândia', 'vietnã', 'coreia do sul', 'nova zelândia', 'áfrica do sul', 'nigéria', 'quênia', 'cuba', 'jamaica', 'paraguai', 'bolívia', 'venezuela'],
  sports: ['futebol', 'basquete', 'natação', 'vôlei', 'tênis', 'skate', 'surfe', 'ciclismo', 'judô', 'ginástica', 'corrida', 'boxe', 'golfe', 'xadrez', 'handebol', 'capoeira', 'patinação', 'atletismo', 'beisebol', 'remo', 'esgrima', 'escalada', 'karatê', 'pingue-pongue', 'badminton', 'polo aquático', 'rúgbi', 'críquete', 'vela', 'mergulho', 'esqui', 'snowboard', 'arco e flecha', 'levantamento de peso', 'triatlo', 'maratona', 'futsal', 'vôlei de praia', 'hipismo', 'taekwondo'],
  nature: ['cachoeira', 'montanha', 'arco-íris', 'vulcão', 'floresta', 'girassol', 'deserto', 'oceano', 'trovão', 'estrela', 'nuvem', 'praia', 'cacto', 'relâmpago', 'lua cheia', 'rio', 'neve', 'ilha', 'caverna', 'orquídea', 'pôr do sol', 'furacão', 'lago', 'semente', 'geleira', 'pântano', 'planalto', 'vale', 'colina', 'recife', 'manguezal', 'primavera', 'outono', 'inverno', 'verão', 'granizo', 'neblina', 'tempestade', 'cometa', 'galáxia'],
  transport: ['bicicleta', 'avião', 'helicóptero', 'submarino', 'trem', 'caminhão', 'patinete', 'navio', 'foguete', 'ônibus', 'motocicleta', 'canoa', 'metrô', 'balão', 'trator', 'ambulância', 'táxi', 'carroça', 'teleférico', 'barco', 'jet ski', 'skate', 'veleiro', 'bonde', 'jangada', 'limusine', 'planador', 'dirigível', 'caiaque', 'iate', 'monociclo', 'triciclo', 'van', 'carrinho de mão', 'charrete', 'lancha', 'hidroavião', 'motoneta', 'minivan', 'caminhonete'],
}

const en: Lists = {
  animals: ['dog', 'cat', 'elephant', 'giraffe', 'turtle', 'butterfly', 'alligator', 'penguin', 'parrot', 'shark', 'rabbit', 'horse', 'monkey', 'lion', 'whale', 'ant', 'owl', 'dolphin', 'zebra', 'camel', 'bee', 'frog', 'kangaroo', 'octopus', 'hippopotamus', 'squirrel', 'chicken', 'cow', 'pig', 'sheep', 'fox', 'wolf', 'bear', 'seal', 'chameleon', 'sloth', 'peacock', 'toucan', 'hedgehog', 'flamingo'],
  food: ['pancake', 'popcorn', 'spaghetti', 'pineapple', 'watermelon', 'chocolate', 'ice cream', 'hamburger', 'sandwich', 'banana', 'strawberry', 'lasagna', 'carrot', 'omelet', 'cupcake', 'pizza', 'cookie', 'avocado', 'pretzel', 'blueberry', 'meatball', 'waffle', 'broccoli', 'mashed potato', 'carrot cake', 'pudding', 'barbecue', 'rice pudding', 'muffin', 'burrito', 'taco', 'lemonade', 'salad', 'biscuit', 'jelly', 'popsicle', 'pancakes', 'cheesecake', 'doughnut', 'apple pie'],
  home: ['refrigerator', 'pillow', 'chair', 'toothbrush', 'television', 'blender', 'window', 'shower', 'couch', 'carpet', 'mirror', 'broom', 'saucepan', 'curtain', 'light bulb', 'drawer', 'remote control', 'towel', 'blanket', 'clock', 'oven', 'closet', 'doorbell', 'staircase', 'fan', 'computer', 'microwave', 'toaster', 'bookshelf', 'desk', 'cushion', 'lamp', 'clothesline', 'iron', 'garden hose', 'scissors', 'umbrella', 'hanger', 'lock', 'bathtub'],
  jobs: ['teacher', 'firefighter', 'doctor', 'astronaut', 'chef', 'dentist', 'veterinarian', 'pilot', 'gardener', 'mail carrier', 'engineer', 'nurse', 'baker', 'photographer', 'driver', 'scientist', 'singer', 'painter', 'lawyer', 'police officer', 'mechanic', 'fisherman', 'architect', 'clown', 'ballerina', 'writer', 'judge', 'carpenter', 'tailor', 'pharmacist', 'waiter', 'farmer', 'electrician', 'plumber', 'lifeguard', 'coach', 'hairdresser', 'detective', 'magician'],
  countries: ['brazil', 'argentina', 'japan', 'canada', 'portugal', 'italy', 'mexico', 'egypt', 'australia', 'france', 'germany', 'china', 'india', 'chile', 'spain', 'greece', 'peru', 'united states', 'russia', 'norway', 'morocco', 'uruguay', 'colombia', 'ireland', 'netherlands', 'switzerland', 'sweden', 'turkey', 'thailand', 'vietnam', 'south korea', 'new zealand', 'south africa', 'nigeria', 'kenya', 'cuba', 'jamaica', 'paraguay', 'bolivia', 'venezuela'],
  sports: ['soccer', 'basketball', 'swimming', 'volleyball', 'tennis', 'skateboarding', 'surfing', 'cycling', 'judo', 'gymnastics', 'running', 'boxing', 'golf', 'chess', 'handball', 'hockey', 'skating', 'baseball', 'rowing', 'fencing', 'climbing', 'karate', 'table tennis', 'football', 'badminton', 'water polo', 'rugby', 'cricket', 'sailing', 'diving', 'skiing', 'snowboarding', 'archery', 'weightlifting', 'triathlon', 'marathon', 'lacrosse', 'beach volleyball', 'horse riding', 'taekwondo'],
  nature: ['waterfall', 'mountain', 'rainbow', 'volcano', 'forest', 'sunflower', 'desert', 'ocean', 'thunder', 'star', 'cloud', 'beach', 'cactus', 'lightning', 'full moon', 'river', 'snow', 'island', 'cave', 'orchid', 'sunset', 'hurricane', 'lake', 'seed', 'glacier', 'swamp', 'plateau', 'valley', 'hill', 'coral reef', 'spring', 'autumn', 'winter', 'summer', 'hail', 'fog', 'storm', 'comet', 'galaxy', 'meadow'],
  transport: ['bicycle', 'airplane', 'helicopter', 'submarine', 'train', 'truck', 'scooter', 'ship', 'rocket', 'bus', 'motorcycle', 'canoe', 'subway', 'hot air balloon', 'tractor', 'ambulance', 'taxi', 'wagon', 'cable car', 'boat', 'jet ski', 'skateboard', 'sailboat', 'tram', 'raft', 'limousine', 'glider', 'blimp', 'kayak', 'yacht', 'unicycle', 'tricycle', 'van', 'wheelbarrow', 'carriage', 'speedboat', 'seaplane', 'moped', 'minivan', 'pickup truck'],
}

const es: Lists = {
  animals: ['perro', 'gato', 'elefante', 'jirafa', 'tortuga', 'mariposa', 'cocodrilo', 'pingüino', 'loro', 'tiburón', 'conejo', 'caballo', 'mono', 'león', 'ballena', 'hormiga', 'búho', 'delfín', 'cebra', 'camello', 'abeja', 'rana', 'canguro', 'pulpo', 'hipopótamo', 'ardilla', 'gallina', 'vaca', 'cerdo', 'oveja', 'zorro', 'lobo', 'oso', 'foca', 'camaleón', 'perezoso', 'pavo real', 'tucán', 'erizo', 'flamenco'],
  food: ['empanada', 'palomitas', 'espaguetis', 'piña', 'sandía', 'chocolate', 'helado', 'hamburguesa', 'tortilla', 'plátano', 'fresa', 'lasaña', 'zanahoria', 'churros', 'arepa', 'pizza', 'galleta', 'aguacate', 'paella', 'gazpacho', 'alfajor', 'flan', 'brócoli', 'tamal', 'pastel de zanahoria', 'arroz con leche', 'asado', 'magdalena', 'burrito', 'taco', 'limonada', 'ensalada', 'bocadillo', 'mermelada', 'polo', 'tarta de queso', 'rosquilla', 'tarta de manzana', 'quesadilla', 'dulce de leche'],
  home: ['nevera', 'almohada', 'silla', 'cepillo de dientes', 'televisión', 'licuadora', 'ventana', 'ducha', 'sofá', 'alfombra', 'espejo', 'escoba', 'olla', 'cortina', 'bombilla', 'cajón', 'control remoto', 'toalla', 'manta', 'reloj', 'horno', 'armario', 'timbre', 'escalera', 'ventilador', 'computadora', 'microondas', 'tostadora', 'estantería', 'escritorio', 'cojín', 'lámpara', 'tendedero', 'plancha', 'manguera', 'tijeras', 'paraguas', 'percha', 'cerradura', 'bañera'],
  jobs: ['maestra', 'bombero', 'médico', 'astronauta', 'cocinero', 'dentista', 'veterinaria', 'piloto', 'jardinero', 'cartero', 'ingeniero', 'enfermera', 'panadero', 'fotógrafo', 'conductor', 'científico', 'cantante', 'pintor', 'abogada', 'policía', 'mecánico', 'pescador', 'arquitecta', 'payaso', 'bailarina', 'escritor', 'juez', 'carpintero', 'costurera', 'farmacéutico', 'camarero', 'agricultor', 'electricista', 'fontanero', 'socorrista', 'entrenador', 'peluquero', 'detective', 'mago', 'presentador'],
  countries: ['brasil', 'argentina', 'japón', 'canadá', 'portugal', 'italia', 'méxico', 'egipto', 'australia', 'francia', 'alemania', 'china', 'india', 'chile', 'españa', 'grecia', 'perú', 'estados unidos', 'rusia', 'noruega', 'marruecos', 'uruguay', 'colombia', 'irlanda', 'holanda', 'suiza', 'suecia', 'turquía', 'tailandia', 'vietnam', 'corea del sur', 'nueva zelanda', 'sudáfrica', 'nigeria', 'kenia', 'cuba', 'jamaica', 'paraguay', 'bolivia', 'venezuela'],
  sports: ['fútbol', 'baloncesto', 'natación', 'voleibol', 'tenis', 'patineta', 'surf', 'ciclismo', 'judo', 'gimnasia', 'atletismo', 'boxeo', 'golf', 'ajedrez', 'balonmano', 'hockey', 'patinaje', 'béisbol', 'remo', 'esgrima', 'escalada', 'kárate', 'ping pong', 'rugby', 'bádminton', 'waterpolo', 'críquet', 'vela', 'buceo', 'esquí', 'snowboard', 'tiro con arco', 'halterofilia', 'triatlón', 'maratón', 'fútbol sala', 'vóley playa', 'equitación', 'taekwondo', 'pádel'],
  nature: ['cascada', 'montaña', 'arcoíris', 'volcán', 'bosque', 'girasol', 'desierto', 'océano', 'trueno', 'estrella', 'nube', 'playa', 'cactus', 'relámpago', 'luna llena', 'río', 'nieve', 'isla', 'cueva', 'orquídea', 'atardecer', 'huracán', 'lago', 'semilla', 'glaciar', 'pantano', 'meseta', 'valle', 'colina', 'arrecife', 'primavera', 'otoño', 'invierno', 'verano', 'granizo', 'niebla', 'tormenta', 'cometa', 'galaxia', 'pradera'],
  transport: ['bicicleta', 'avión', 'helicóptero', 'submarino', 'tren', 'camión', 'patinete', 'barco', 'cohete', 'autobús', 'motocicleta', 'canoa', 'metro', 'globo', 'tractor', 'ambulancia', 'taxi', 'carreta', 'teleférico', 'lancha', 'moto de agua', 'velero', 'tranvía', 'furgoneta', 'balsa', 'limusina', 'planeador', 'dirigible', 'kayak', 'yate', 'monociclo', 'triciclo', 'camioneta', 'carretilla', 'carruaje', 'lancha rápida', 'hidroavión', 'ciclomotor', 'minivan', 'todoterreno'],
}

const BY_LANG: Record<string, Lists> = { pt, en, es }

export function wordsFor(lang: string, cat: CategoryId): string[] {
  return (BY_LANG[lang] ?? BY_LANG.en)[cat]
}

/** A handful of suggestions to tap, different each time the picker opens. */
export function suggestions(lang: string, cat: CategoryId, n = 6): string[] {
  const all = [...wordsFor(lang, cat)]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all.slice(0, n)
}

export function randomWord(lang: string, cat: CategoryId): string {
  const all = wordsFor(lang, cat)
  return all[Math.floor(Math.random() * all.length)]
}

/** Same rule the server enforces (hangman_set_word): letters, spaces and
 *  hyphens, 2–30 characters, starting and ending with a letter. */
export function validWord(w: string): boolean {
  const s = w.trim().replace(/\s+/g, ' ')
  if (s.length < 2 || s.length > 30) return false
  const folded = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /^[a-z]([a-z -]*[a-z])?$/.test(folded) && folded.replace(/[^a-z]/g, '').length >= 2
}
