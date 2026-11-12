#!/usr/bin/env python3
"""Question bank for the buzzer quiz → supabase/migration-095-quiz-bank.sql.

    python3 scripts/quiz-bank.py

Rules for questions (keep them when adding more):
  * family-friendly, for kids AND grandparents; timeless facts (no "current
    president", no records that change);
  * SHORT answers (one to three words) — people answer out loud or by typing;
  * list every fair way to say the answer (digits AND words for numbers,
    common synonyms). The first one is what the reveal shows.
  * The server forgives accents, case, articles and a small typo
    (quiz_matches, migration 094) — no need to list those variants.
Each entry: (category, {lang: (question, [answers...])}, difficulty 1–3).
"""
import os

Q = [
    # ── general ──────────────────────────────────────────────────────────
    ('general', {'pt': ('Quantos dias tem uma semana?', ['7', 'sete']),
                 'en': ('How many days are in a week?', ['7', 'seven']),
                 'es': ('¿Cuántos días tiene una semana?', ['7', 'siete'])}, 1),
    ('general', {'pt': ('Quantos meses tem um ano?', ['12', 'doze']),
                 'en': ('How many months are in a year?', ['12', 'twelve']),
                 'es': ('¿Cuántos meses tiene un año?', ['12', 'doce'])}, 1),
    ('general', {'pt': ('Qual cor se forma misturando azul e amarelo?', ['verde']),
                 'en': ('What colour do you get mixing blue and yellow?', ['green']),
                 'es': ('¿Qué color sale al mezclar azul y amarillo?', ['verde'])}, 1),
    ('general', {'pt': ('Qual cor se forma misturando vermelho e branco?', ['rosa', 'cor de rosa']),
                 'en': ('What colour do you get mixing red and white?', ['pink']),
                 'es': ('¿Qué color sale al mezclar rojo y blanco?', ['rosa', 'rosado'])}, 1),
    ('general', {'pt': ('Quantos lados tem um triângulo?', ['3', 'três']),
                 'en': ('How many sides does a triangle have?', ['3', 'three']),
                 'es': ('¿Cuántos lados tiene un triángulo?', ['3', 'tres'])}, 1),
    ('general', {'pt': ('Quantos minutos tem uma hora?', ['60', 'sessenta']),
                 'en': ('How many minutes are in an hour?', ['60', 'sixty']),
                 'es': ('¿Cuántos minutos tiene una hora?', ['60', 'sesenta'])}, 1),
    ('general', {'pt': ('Quantas cores tem o arco-íris?', ['7', 'sete']),
                 'en': ('How many colours are in a rainbow?', ['7', 'seven']),
                 'es': ('¿Cuántos colores tiene el arcoíris?', ['7', 'siete'])}, 1),
    ('general', {'pt': ('Quantas patas tem uma aranha?', ['8', 'oito']),
                 'en': ('How many legs does a spider have?', ['8', 'eight']),
                 'es': ('¿Cuántas patas tiene una araña?', ['8', 'ocho'])}, 1),
    ('general', {'pt': ('Quanto é 7 vezes 8?', ['56', 'cinquenta e seis']),
                 'en': ('What is 7 times 8?', ['56', 'fifty six']),
                 'es': ('¿Cuánto es 7 por 8?', ['56', 'cincuenta y seis'])}, 2),
    ('general', {'pt': ('Quantos anos tem um século?', ['100', 'cem']),
                 'en': ('How many years are in a century?', ['100', 'one hundred', 'a hundred', 'hundred']),
                 'es': ('¿Cuántos años tiene un siglo?', ['100', 'cien'])}, 1),
    ('general', {'pt': ('Quantas teclas tem um piano comum?', ['88', 'oitenta e oito']),
                 'en': ('How many keys does a standard piano have?', ['88', 'eighty eight']),
                 'es': ('¿Cuántas teclas tiene un piano normal?', ['88', 'ochenta y ocho'])}, 3),
    ('general', {'pt': ('Que instrumento tem seis cordas e é muito usado no samba e no rock?', ['violão', 'guitarra']),
                 'en': ('Which six-string instrument is used in rock and folk?', ['guitar']),
                 'es': ('¿Qué instrumento de seis cuerdas se usa en el rock y el folclore?', ['guitarra'])}, 1),
    ('general', {'pt': ('Quantos jogadores um time de futebol tem em campo?', ['11', 'onze']),
                 'en': ('How many players does a soccer team have on the field?', ['11', 'eleven']),
                 'es': ('¿Cuántos jugadores tiene un equipo de fútbol en la cancha?', ['11', 'once'])}, 1),
    # ── geography ────────────────────────────────────────────────────────
    ('geography', {'pt': ('Qual é a capital do Brasil?', ['Brasília']),
                   'en': ('What is the capital of Brazil?', ['Brasília', 'Brasilia']),
                   'es': ('¿Cuál es la capital de Brasil?', ['Brasilia'])}, 1),
    ('geography', {'pt': ('Qual é a capital da França?', ['Paris']),
                   'en': ('What is the capital of France?', ['Paris']),
                   'es': ('¿Cuál es la capital de Francia?', ['París'])}, 1),
    ('geography', {'pt': ('Qual é a capital do Japão?', ['Tóquio']),
                   'en': ('What is the capital of Japan?', ['Tokyo']),
                   'es': ('¿Cuál es la capital de Japón?', ['Tokio'])}, 1),
    ('geography', {'pt': ('Qual é a capital da Argentina?', ['Buenos Aires']),
                   'en': ('What is the capital of Argentina?', ['Buenos Aires']),
                   'es': ('¿Cuál es la capital de Argentina?', ['Buenos Aires'])}, 1),
    ('geography', {'pt': ('Qual é a capital da Itália?', ['Roma']),
                   'en': ('What is the capital of Italy?', ['Rome']),
                   'es': ('¿Cuál es la capital de Italia?', ['Roma'])}, 1),
    ('geography', {'pt': ('Qual é a capital do Canadá?', ['Ottawa', 'Otawa']),
                   'en': ('What is the capital of Canada?', ['Ottawa']),
                   'es': ('¿Cuál es la capital de Canadá?', ['Ottawa', 'Otawa'])}, 2),
    ('geography', {'pt': ('Qual é o maior oceano do mundo?', ['Pacífico', 'oceano Pacífico']),
                   'en': ('What is the largest ocean in the world?', ['Pacific', 'Pacific Ocean']),
                   'es': ('¿Cuál es el océano más grande del mundo?', ['Pacífico', 'océano Pacífico'])}, 1),
    ('geography', {'pt': ('Qual é o maior país do mundo em área?', ['Rússia']),
                   'en': ('What is the largest country in the world by area?', ['Russia']),
                   'es': ('¿Cuál es el país más grande del mundo en superficie?', ['Rusia'])}, 2),
    ('geography', {'pt': ('Em que continente fica o Egito?', ['África']),
                   'en': ('Which continent is Egypt in?', ['Africa']),
                   'es': ('¿En qué continente está Egipto?', ['África'])}, 1),
    ('geography', {'pt': ('Qual é o maior deserto quente do mundo?', ['Saara', 'Sahara']),
                   'en': ('What is the largest hot desert in the world?', ['Sahara']),
                   'es': ('¿Cuál es el desierto cálido más grande del mundo?', ['Sahara'])}, 2),
    ('geography', {'pt': ('Qual é a montanha mais alta do mundo?', ['Everest', 'monte Everest']),
                   'en': ('What is the highest mountain in the world?', ['Everest', 'Mount Everest']),
                   'es': ('¿Cuál es la montaña más alta del mundo?', ['Everest', 'monte Everest'])}, 1),
    ('geography', {'pt': ('Em que país fica a Torre Eiffel?', ['França']),
                   'en': ('In which country is the Eiffel Tower?', ['France']),
                   'es': ('¿En qué país está la Torre Eiffel?', ['Francia'])}, 1),
    ('geography', {'pt': ('Quantos continentes existem?', ['6', 'seis', '7', 'sete']),
                   'en': ('How many continents are there?', ['7', 'seven', '6', 'six']),
                   'es': ('¿Cuántos continentes hay?', ['6', 'seis', '7', 'siete'])}, 2),
    ('geography', {'pt': ('Qual é o rio mais volumoso do mundo?', ['Amazonas', 'rio Amazonas']),
                   'en': ('Which river carries the most water in the world?', ['Amazon', 'Amazon River']),
                   'es': ('¿Cuál es el río más caudaloso del mundo?', ['Amazonas', 'río Amazonas'])}, 2),
    # ── science ──────────────────────────────────────────────────────────
    ('science', {'pt': ('Qual planeta é conhecido como planeta vermelho?', ['Marte']),
                 'en': ('Which planet is known as the red planet?', ['Mars']),
                 'es': ('¿Qué planeta es conocido como el planeta rojo?', ['Marte'])}, 1),
    ('science', {'pt': ('Qual é o maior planeta do sistema solar?', ['Júpiter']),
                 'en': ('What is the largest planet in the solar system?', ['Jupiter']),
                 'es': ('¿Cuál es el planeta más grande del sistema solar?', ['Júpiter'])}, 1),
    ('science', {'pt': ('Qual é a estrela mais próxima da Terra?', ['Sol', 'o Sol']),
                 'en': ('What is the closest star to Earth?', ['Sun', 'the Sun']),
                 'es': ('¿Cuál es la estrella más cercana a la Tierra?', ['Sol', 'el Sol'])}, 1),
    ('science', {'pt': ('A que temperatura a água ferve, em graus Celsius?', ['100', 'cem']),
                 'en': ('At what temperature does water boil, in degrees Celsius?', ['100', 'one hundred', 'a hundred']),
                 'es': ('¿A qué temperatura hierve el agua, en grados Celsius?', ['100', 'cien'])}, 1),
    ('science', {'pt': ('Qual gás as plantas soltam e nós respiramos?', ['oxigênio']),
                 'en': ('Which gas do plants give off that we breathe?', ['oxygen']),
                 'es': ('¿Qué gas sueltan las plantas y nosotros respiramos?', ['oxígeno'])}, 1),
    ('science', {'pt': ('Qual é o símbolo químico da água?', ['H2O', 'h dois o']),
                 'en': ('What is the chemical formula of water?', ['H2O', 'h two o']),
                 'es': ('¿Cuál es la fórmula química del agua?', ['H2O', 'h dos o'])}, 1),
    ('science', {'pt': ('Quantos ossos tem o corpo de um adulto?', ['206', 'duzentos e seis']),
                 'en': ('How many bones are in an adult human body?', ['206', 'two hundred and six', 'two hundred six']),
                 'es': ('¿Cuántos huesos tiene el cuerpo de un adulto?', ['206', 'doscientos seis'])}, 3),
    ('science', {'pt': ('Qual órgão bombeia o sangue pelo corpo?', ['coração']),
                 'en': ('Which organ pumps blood around the body?', ['heart']),
                 'es': ('¿Qué órgano bombea la sangre por el cuerpo?', ['corazón'])}, 1),
    ('science', {'pt': ('Quantos planetas tem o sistema solar?', ['8', 'oito']),
                 'en': ('How many planets are in the solar system?', ['8', 'eight']),
                 'es': ('¿Cuántos planetas tiene el sistema solar?', ['8', 'ocho'])}, 1),
    ('science', {'pt': ('Que força faz as coisas caírem no chão?', ['gravidade']),
                 'en': ('Which force makes things fall to the ground?', ['gravity']),
                 'es': ('¿Qué fuerza hace que las cosas caigan al suelo?', ['gravedad'])}, 1),
    ('science', {'pt': ('Qual é o satélite natural da Terra?', ['Lua', 'a Lua']),
                 'en': ("What is Earth's natural satellite?", ['Moon', 'the Moon']),
                 'es': ('¿Cuál es el satélite natural de la Tierra?', ['Luna', 'la Luna'])}, 1),
    ('science', {'pt': ('Qual é o maior órgão do corpo humano?', ['pele', 'a pele']),
                 'en': ('What is the largest organ of the human body?', ['skin', 'the skin']),
                 'es': ('¿Cuál es el órgano más grande del cuerpo humano?', ['piel', 'la piel'])}, 2),
    # ── animals ──────────────────────────────────────────────────────────
    ('animals', {'pt': ('Qual é o maior animal do mundo?', ['baleia azul', 'baleia-azul']),
                 'en': ('What is the largest animal in the world?', ['blue whale']),
                 'es': ('¿Cuál es el animal más grande del mundo?', ['ballena azul'])}, 1),
    ('animals', {'pt': ('Qual é o animal terrestre mais rápido?', ['guepardo', 'chita']),
                 'en': ('What is the fastest land animal?', ['cheetah']),
                 'es': ('¿Cuál es el animal terrestre más rápido?', ['guepardo', 'chita'])}, 1),
    ('animals', {'pt': ('Que animal é conhecido como o rei da selva?', ['leão']),
                 'en': ('Which animal is called the king of the jungle?', ['lion']),
                 'es': ('¿Qué animal es conocido como el rey de la selva?', ['león'])}, 1),
    ('animals', {'pt': ('Quantas patas tem um inseto?', ['6', 'seis']),
                 'en': ('How many legs does an insect have?', ['6', 'six']),
                 'es': ('¿Cuántas patas tiene un insecto?', ['6', 'seis'])}, 1),
    ('animals', {'pt': ('Qual ave não voa e vive na Antártida?', ['pinguim']),
                 'en': ('Which bird cannot fly and lives in Antarctica?', ['penguin']),
                 'es': ('¿Qué ave no vuela y vive en la Antártida?', ['pingüino'])}, 1),
    ('animals', {'pt': ('Que animal produz o mel?', ['abelha']),
                 'en': ('Which animal makes honey?', ['bee', 'honeybee']),
                 'es': ('¿Qué animal produce la miel?', ['abeja'])}, 1),
    ('animals', {'pt': ('Qual é o filhote do cavalo?', ['potro']),
                 'en': ('What is a baby horse called?', ['foal', 'colt', 'filly']),
                 'es': ('¿Cómo se llama la cría del caballo?', ['potro'])}, 2),
    ('animals', {'pt': ('Qual animal tem o pescoço mais comprido?', ['girafa']),
                 'en': ('Which animal has the longest neck?', ['giraffe']),
                 'es': ('¿Qué animal tiene el cuello más largo?', ['jirafa'])}, 1),
    ('animals', {'pt': ('Quantos braços tem um polvo?', ['8', 'oito']),
                 'en': ('How many arms does an octopus have?', ['8', 'eight']),
                 'es': ('¿Cuántos brazos tiene un pulpo?', ['8', 'ocho'])}, 1),
    ('animals', {'pt': ('Que animal muda de cor para se camuflar?', ['camaleão', 'polvo']),
                 'en': ('Which lizard changes colour to blend in?', ['chameleon']),
                 'es': ('¿Qué animal cambia de color para camuflarse?', ['camaleón', 'pulpo'])}, 1),
    ('animals', {'pt': ('Qual mamífero consegue voar?', ['morcego']),
                 'en': ('Which mammal can fly?', ['bat']),
                 'es': ('¿Qué mamífero puede volar?', ['murciélago'])}, 1),
    ('animals', {'pt': ('Qual mamífero da Austrália põe ovos e tem bico de pato?', ['ornitorrinco']),
                 'en': ('Which egg-laying mammal from Australia has a duck bill?', ['platypus']),
                 'es': ('¿Qué mamífero de Australia pone huevos y tiene pico de pato?', ['ornitorrinco'])}, 2),
    # ── sports ───────────────────────────────────────────────────────────
    ('sports', {'pt': ('Em que esporte se usa uma raquete e uma peteca?', ['badminton']),
                'en': ('Which sport uses a racket and a shuttlecock?', ['badminton']),
                'es': ('¿Qué deporte usa raqueta y volante?', ['bádminton'])}, 1),
    ('sports', {'pt': ('De quantos em quantos anos acontecem as Olimpíadas de verão?', ['4', 'quatro']),
                'en': ('How often are the Summer Olympics held, in years?', ['4', 'four', 'every 4 years', 'every four years']),
                'es': ('¿Cada cuántos años son los Juegos Olímpicos de verano?', ['4', 'cuatro'])}, 1),
    ('sports', {'pt': ('Quantos anéis tem o símbolo olímpico?', ['5', 'cinco']),
                'en': ('How many rings are in the Olympic symbol?', ['5', 'five']),
                'es': ('¿Cuántos aros tiene el símbolo olímpico?', ['5', 'cinco'])}, 1),
    ('sports', {'pt': ('Em que esporte se faz uma cesta?', ['basquete', 'basquetebol']),
                'en': ('In which sport do you shoot a basket?', ['basketball']),
                'es': ('¿En qué deporte se encesta?', ['baloncesto', 'básquet', 'básquetbol'])}, 1),
    ('sports', {'pt': ('Quantos pontos vale um gol no futebol?', ['1', 'um']),
                'en': ('How many points is a goal worth in soccer?', ['1', 'one']),
                'es': ('¿Cuántos puntos vale un gol en el fútbol?', ['1', 'uno'])}, 1),
    ('sports', {'pt': ('Qual país ganhou mais Copas do Mundo de futebol masculino?', ['Brasil']),
                'en': ("Which country has won the most men's soccer World Cups?", ['Brazil']),
                'es': ('¿Qué país ganó más Mundiales de fútbol masculino?', ['Brasil'])}, 1),
    ('sports', {'pt': ('Em que esporte existe o "xeque-mate"?', ['xadrez']),
                'en': ('In which game do you say "checkmate"?', ['chess']),
                'es': ('¿En qué juego se dice "jaque mate"?', ['ajedrez'])}, 1),
    ('sports', {'pt': ('Quantos jogadores tem um time de vôlei em quadra?', ['6', 'seis']),
                'en': ('How many players does a volleyball team have on court?', ['6', 'six']),
                'es': ('¿Cuántos jugadores tiene un equipo de vóleibol en la cancha?', ['6', 'seis'])}, 2),
    # ── food ─────────────────────────────────────────────────────────────
    ('food', {'pt': ('De que fruta se faz o guacamole?', ['abacate']),
              'en': ('Which fruit is guacamole made from?', ['avocado']),
              'es': ('¿De qué fruta se hace el guacamole?', ['aguacate', 'palta'])}, 1),
    ('food', {'pt': ('De que grão se faz a pipoca?', ['milho']),
              'en': ('Which grain is popcorn made from?', ['corn', 'maize']),
              'es': ('¿De qué grano se hacen las palomitas?', ['maíz'])}, 1),
    ('food', {'pt': ('Que fruta é amarela e os macacos adoram?', ['banana']),
              'en': ('Which yellow fruit do monkeys love?', ['banana']),
              'es': ('¿Qué fruta amarilla les encanta a los monos?', ['plátano', 'banana'])}, 1),
    ('food', {'pt': ('Qual é o ingrediente principal do chocolate?', ['cacau']),
              'en': ('What is the main ingredient of chocolate?', ['cocoa', 'cacao']),
              'es': ('¿Cuál es el ingrediente principal del chocolate?', ['cacao'])}, 1),
    ('food', {'pt': ('De que país vem a pizza?', ['Itália']),
              'en': ('Which country does pizza come from?', ['Italy']),
              'es': ('¿De qué país viene la pizza?', ['Italia'])}, 1),
    ('food', {'pt': ('De que país vem o sushi?', ['Japão']),
              'en': ('Which country does sushi come from?', ['Japan']),
              'es': ('¿De qué país viene el sushi?', ['Japón'])}, 1),
    ('food', {'pt': ('Que legume deixa os olhos lacrimejando quando cortamos?', ['cebola']),
              'en': ('Which vegetable makes your eyes water when you cut it?', ['onion']),
              'es': ('¿Qué verdura hace llorar al cortarla?', ['cebolla'])}, 1),
    ('food', {'pt': ('De que leite se faz o queijo mussarela tradicional italiano?', ['búfala', 'leite de búfala']),
              'en': ('Traditional Italian mozzarella is made from which milk?', ['buffalo', 'buffalo milk', 'water buffalo']),
              'es': ('¿Con qué leche se hace la mozzarella italiana tradicional?', ['búfala', 'leche de búfala'])}, 3),
    ('food', {'pt': ('Qual fruta tem as sementes do lado de fora?', ['morango']),
              'en': ('Which fruit has its seeds on the outside?', ['strawberry']),
              'es': ('¿Qué fruta tiene las semillas por fuera?', ['fresa', 'frutilla'])}, 1),
    ('food', {'pt': ('Qual é o principal ingrediente do pão de queijo, além do queijo?', ['polvilho', 'tapioca', 'mandioca']),
              'en': ('Apart from cheese, what flour makes Brazilian cheese bread?', ['tapioca', 'cassava', 'manioc']),
              'es': ('Además del queso, ¿qué almidón lleva el pan de queso brasileño?', ['tapioca', 'mandioca', 'yuca'])}, 2),
]

# Brazil-specific extras only make sense in Portuguese.
PT_ONLY = [
    ('brazil', ('Qual é o maior estado do Brasil?', ['Amazonas']), 1),
    ('brazil', ('Em que cidade fica o Cristo Redentor?', ['Rio de Janeiro', 'Rio']), 1),
    ('brazil', ('Qual é a festa brasileira com escolas de samba?', ['Carnaval']), 1),
    ('brazil', ('Qual é o prato típico feito com feijão preto e carnes de porco?', ['feijoada']), 1),
    ('brazil', ('Em que ano o Brasil foi descoberto pelos portugueses?', ['1500', 'mil e quinhentos']), 1),
    ('brazil', ('Qual bioma brasileiro é a maior floresta tropical do mundo?', ['Amazônia', 'floresta amazônica']), 1),
    ('brazil', ('Quantos estados tem o Brasil?', ['26', 'vinte e seis', '27', 'vinte e sete']), 2),
    ('brazil', ('Qual é a cachoeira famosa na divisa com a Argentina, no Paraná?', ['Foz do Iguaçu', 'Cataratas do Iguaçu', 'Iguaçu']), 2),
]


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def sql_arr(xs):
    return 'array[' + ', '.join(sql_str(x) for x in xs) + ']'


# More questions live in scripts/quiz_extra/<category>.py (Q = [...] in the
# same shape; brazil.py has PT_ONLY). Exact and near-exact duplicates are
# dropped below, keeping the first.
import glob
import runpy
import unicodedata

for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'quiz_extra', '*.py'))):
    ns = runpy.run_path(f)
    Q += ns.get('Q', [])
    PT_ONLY += ns.get('PT_ONLY', [])


def norm(q):
    q = unicodedata.normalize('NFKD', q.lower())
    return ''.join(ch for ch in q if ch.isalnum())


seen_q = set()
dropped = 0


def fresh(lang, q):
    global dropped
    k = (lang, norm(q))
    if k in seen_q:
        dropped += 1
        return False
    seen_q.add(k)
    return True


rows = []
for cat, langs, diff in Q:
    for lang, (q, answers) in langs.items():
        if not fresh(lang, q):
            continue
        rows.append(f"  ({sql_str(lang)}, {sql_str(cat)}, {sql_str(q)}, {sql_arr(answers)}, {diff})")
for cat, (q, answers), diff in PT_ONLY:
    if not fresh('pt', q):
        continue
    rows.append(f"  ('pt', {sql_str(cat)}, {sql_str(q)}, {sql_arr(answers)}, {diff})")

out = os.path.join(os.path.dirname(__file__), '..', '..', 'supabase', 'migration-095-quiz-bank.sql')
with open(out, 'w', encoding='utf-8') as f:
    f.write('-- 095-quiz-bank.sql — the buzzer quiz question bank (migration 094).\n')
    f.write('-- GENERATED by mobile/scripts/quiz-bank.py — edit the script, not this file.\n')
    f.write('-- Re-runnable: replaces the whole bank.\n\n')
    f.write('delete from public.quiz_questions;\n')
    f.write('insert into public.quiz_questions (lang, category, question, answers, difficulty) values\n')
    f.write(',\n'.join(rows) + ';\n')
by_lang = {l: sum(1 for r in rows if r.startswith(f"  ('{l}'")) for l in ('pt', 'en', 'es')}
print(f'{len(rows)} questions {by_lang}, {dropped} duplicates dropped →', os.path.normpath(out))
