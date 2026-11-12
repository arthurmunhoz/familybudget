# Próxima release (depois da 1.5.1)

Melhorias pequenas, anotadas com o Arthur. Status: [ ] a fazer · [x] feito

## Pendências que já existiam
- [ ] Rodar o eval do assistente com as frases novas (período de dinheiro, vários pets, mês anterior)
- [ ] Push dos commits locais (9168f8e, 3678e99) depois do OK

## Ideias do Arthur

### 1. Lembretes das rotinas dos pets — FEITO no código (2026-11-11), falta aplicar migration 098, publicar api/widget.ts e testar no aparelho
- [ ] Cada rotina pode ter um horário aproximado (ex.: "Ração da manhã ~8h").
- [ ] Se ninguém marcou como feita até um tempo depois desse horário, manda uma notificação para a família: "Ninguém marcou a ração da Lola ainda. Já fez?"
- [ ] A notificação tem um botão de ação "Feito", que marca a tarefa sem abrir o app.

Notas técnicas:
- `pet_care_tasks` (migration 069) hoje não tem horário: precisa de uma coluna nova (ex. `remind_at time`, opcional).
- Hoje só existe o digest diário das 8h (`api/send-digest.ts`, cron 1x/dia). Lembretes por horário pedem um cron mais frequente (o plano Hobby da Vercel só permite 1x/dia) ou notificações locais agendadas no próprio aparelho.
- Botão "Feito" na notificação: categoria de notificação com ação no iOS/Android (expo-notifications) que grava em `pet_task_done`.
- [ ] Quem recebe: cada membro escolhe. Um interruptor por pessoa, tipo "Lembretes dos pets"; quem não cuida dos pets desliga e não recebe. Decidido com o Arthur.

### 2. Calendário com visão Dia / Semana / Mês — FEITO no código (2026-11-11), falta testar no iPad/Mac
Código no branch `worktree-agent-a22918bb1736ad8a7` (ver `mobile/CLAUDE.md` › Calendar). Conferido no simulador do iPhone 17; iPad/Mac ainda não vistos.
- [x] Seletor Dia · Semana · Mês no topo do calendário.
- [x] **Mês**: a grade de hoje + a lista de eventos embaixo, com mais detalhe (horário, quem, local).
- [x] **Semana**: 7 dias lado a lado com os eventos posicionados no horário.
- [x] **Dia**: linha do tempo por hora com os eventos desenhados nos próprios horários (sem lista embaixo); eventos de dia inteiro numa faixa no topo.
- [x] Deslizar para o lado troca de dia/semana/mês.

Notas técnicas:
- [x] Remover a visão "Próximos" (hoje `mode: 'month' | 'upcoming'` em `mobile/src/apps/calendar/Calendar.tsx`). Decidido com o Arthur.
- A expansão de recorrência (`occurrencesByDay`) já serve para Dia e Semana.
- Eventos que se sobrepõem no Dia/Semana precisam ser lado a lado.
- [ ] **Tem que ficar bom em todo tamanho de tela**: celular, tablet (iPad/Android, em pé e deitado) e Mac (o app de iPad rodando no Mac com Apple Silicon, não a web). No grande, aproveitar o espaço (ex.: semana com 7 colunas largas, mês com a lista ao lado da grade em vez de embaixo). Testar nos três tamanhos antes de liberar.
- Só no app (iOS/Android). A versão web não recebe mais nada. Decidido com o Arthur.

### 3. Modo porta-retrato (em Utilidades) — FEITO no código (2026-11-11), falta testar no aparelho
Código no branch `worktree-agent-af227afffb40782d4` (ver `mobile/CLAUDE.md` › Utilities › Photo frame). Migration 100 (`supabase/migration-100-photo-frame.sql`) testada no PGlite, NÃO aplicada. Telas: `/calc/frame` (ajustes + álbum) e `/calc/frame-show` (o porta-retrato).
Transforma o aparelho (ideal: tablet velho na sala) num porta-retrato.

Proposta:
- [x] **Fotos do aparelho (grátis)**: a pessoa escolhe as fotos no seletor do sistema; nada sobe para o servidor.
- [x] **Álbum da família (colaborativo)**: cada membro adiciona fotos; todos os porta-retratos da casa mostram. Sobe para o Storage (bucket `documents`, caminho `<household>/frame/...`, mesmas regras de hoje).
  - Reduzir antes de subir: lado maior ~1600 px, JPEG ~80% ⇒ ~300–400 KB por foto.
  - Limite: grátis ~30 fotos por casa; Plus ~500. Mais um motivo para assinar.
  - O aparelho baixa cada foto UMA vez e guarda em cache; o slideshow roda offline. Sem isso, o custo de tráfego explode (um porta-retrato ligado o dia todo baixaria a mesma foto centenas de vezes).
- [x] Tela: tela sempre acesa enquanto aberto, transição suave com zoom lento, legenda "adicionada por Fulano".
- [x] Extras na tela: relógio + data, próximo evento do calendário, rotina dos pets pendente. (Nudges ao vivo ficou de fora.)
- [x] Modo noite: escurece ou apaga num horário. (A tela continua acesa: sem API de brilho no binário.)
- [x] Datas especiais: no aniversário de alguém, prioriza fotos com essa pessoa (ou marcadas para ela).
- [x] Deitado/em pé, tablet e Mac (mesmo requisito do calendário). No celular o app é travado em pé: botão "Girar" desenha a tela deitada; girar de verdade pede `orientation: default` + expo-screen-orientation (rebuild).

Contas de espaço (aprox.):
- 400 KB × 500 fotos = 200 MB por casa no limite do Plus; 30 fotos grátis = 12 MB.
- 1.000 casas ativas com ~100 fotos cada ≈ 40 GB. O Supabase Pro inclui 100 GB de arquivos (depois ~US$ 0,02/GB/mês); o tráfego também tem franquia (~250 GB), por isso o cache local é obrigatório.
- A conferir: plano atual do Supabase e quanto o bucket já usa hoje.

### 4. Jogos em família — FEITO (forca, batalha naval, quiz; migrations 090–097 aplicadas)
Forca PRONTA (2026-11-10): ao vivo (times Laranja/Roxo, casa que sobe/cai, tela sem rolagem, como jogar ilustrado) + "mandar uma forca" (uma rodada, resultado volta, mandar de volta) + convite de sala com push (desligável em Ajustes) e card na Home. Migrations 090–092 aplicadas; servidor publicado. Batalha naval FEITA no código (2026-11-11): times, posicionar frota em equipe, mirar + Fogo, acertou joga de novo, tela sem rolagem. Migration 093 aplicada.
Quiz com campainha FEITO no código (2026-11-11): campainha (vale quem o servidor recebe primeiro), resposta falando ou digitando, conferência tolerante, 215 perguntas pt/en/es. Migrations 094–095 testadas localmente.

Jogos originais nossos (gêneros clássicos, sem copiar nenhum jogo existente).

Dois formatos:
- **Ao vivo (todos juntos, cada um no seu celular)**: preferência do Arthur para os jogos de sala, em vez de passar um aparelho.
- **À distância (cada um no seu celular)**: usa o Realtime do Supabase que já temos (igual a lista de compras).

Ideias:
- [ ] **Forca da família** (ideia do Arthur): uma pessoa (ou um time) escolhe a palavra e uma dica para outro membro; ele tenta adivinhar letra por letra.
  - **Modo "mandar uma forca"** (mantido pelo Arthur): o desafiante escolhe a palavra (mesmas categorias/sugestões/aleatória do modo ao vivo) e manda para um ou mais membros; cada um recebe notificação ("Mãe te mandou uma forca!") e joga quando puder durante o dia; o resultado volta para quem mandou.
  - **Modo ao vivo (time contra time, cada um no seu celular)** — decidido com o Arthur, substitui o "passa o aparelho":
    - Alguém abre uma partida; os membros da casa entram numa sala de espera e cada um escolhe Time A ou Time B.
    - Cada um marca "Pronto"; quando todos estão prontos, o jogo começa.
    - Os times alternam: um escolhe a palavra, o outro adivinha; na rodada seguinte invertem.
    - **A dica é a categoria** (decidido com o Arthur): quem escolhe primeiro pega uma categoria (Animais, Comidas, Filmes, Países, Profissões, Objetos da casa…), que aparece como dica para o outro time.
      - Dentro da categoria, o app sugere algumas palavras para tocar e escolher;
      - ou "Palavra aleatória" (o app sorteia dentro da categoria);
      - ou digitar uma palavra própria (com a categoria como dica).
      - Listas de palavras em pt/en/es; fácil/médio/difícil depois, se fizer falta.
    - Dentro do time, a vez gira: cada rodada é uma pessoa diferente que escolhe/chuta (A1, A2, A3…).
    - Todos os celulares mostram a forca ao vivo (Supabase Realtime); só quem está na vez pode chutar.
    - Placar por time ao final de N rodadas.
    - Casos a tratar: alguém sai/cai no meio (pula a vez dele), times desiguais, tempo por rodada (opcional).
  - Acentos não contam ("ação" aceita A, C, A, O); filtro de palavras inválidas; histórico de vitórias por pessoa.
  - Desenho da forca original nosso (ex.: uma casinha/telhado do One Roof sendo montada em vez do boneco).
- [ ] **Batalha naval** (ideia do Arthur): mesmo formato ao vivo da forca (sala de espera, Time A/B, "Pronto", vez girando dentro do time).
  - Preparação: cada time monta a sua frota no tabuleiro dele; qualquer membro do time arrasta/gira os navios e todos do time veem ao vivo. Botão "Posicionar aleatório". Quando os dois times confirmam, começa.
  - Rodada: a pessoa da vez escolhe uma casa no tabuleiro inimigo → água / acertou / afundou. **Acertou = atira de novo** (decidido com o Arthur); errou passa a vez.
  - Os celulares do time mostram o próprio tabuleiro + o mapa de tiros no inimigo (no celular: alternar entre os dois; no tablet/Mac: lado a lado).
  - O tabuleiro inimigo NUNCA vai para o celular do outro time: o servidor guarda as posições e só responde água/acerto (senão dá para trapacear).
  - Tabuleiro 8×8 ou 10×10, partida rápida (~10–15 min). Visual nosso, sem copiar nenhuma versão comercial.
- [ ] **Quiz com campainha** (ideia do Arthur): mesmo esquema ao vivo (sala, times ou cada um por si).
  - A pergunta aparece em todos os celulares ao mesmo tempo; quem souber aperta o botão grande na tela.
  - Quem apertou primeiro tem ~10 s para responder **falando** (mesmo reconhecimento de voz do assistente) **ou digitando**.
  - Errou: a pergunta reabre para os outros (quem errou fica fora dessa). Acertou: ponto pro time.
  - Justiça na campainha: vale a ordem em que o SERVIDOR recebeu os toques (cada celular tem atraso de rede diferente); bloqueia os outros na hora.
  - Conferir a resposta: primeiro comparação tolerante (sem acento, maiúscula, pequeno erro de digitação, respostas alternativas cadastradas). Na dúvida, pergunta ao Claude Haiku "isso vale?" (barato).
  - Banco de perguntas: categorias (geral, Brasil, filmes, esportes, ciência, infantil…) e níveis; pt/en/es. Gerar com IA uma vez, revisar e guardar (não gerar ao vivo).

Pensar:
- Só os jogos que o Arthur sugeriu: forca, batalha naval, quiz com campainha. Os três compartilham a mesma base ao vivo (sala de espera, times, "Pronto", vez girando): fazer essa base uma vez e reaproveitar.
- Plus: alguns jogos ou baralhos extras só no Plus?
- Conteúdo (perguntas, palavras) dá trabalho de escrever nas 3 línguas.

### 5. Lançamento "encolhe e encaixa" na lista — FEITO no Dinheiro (2026-11-11); lista de compras não (campo fica aberto, vários itens por envio)
Ao salvar um gasto, o formulário não some simplesmente: ele encolhe, vira o item da lista e encaixa na posição dele; a linha brilha um instante na cor do orçamento.
- Começar pelo novo lançamento no Dinheiro (MonthDetail + EntryForm); se ficar bom, levar para lista de compras, eventos do calendário, rotinas dos pets.
- Técnica: um "cartão fantasma" por cima da tela, com o visual da linha, animado (Reanimated) do retângulo do formulário até o retângulo medido da linha nova; a lista rola até a linha antes, se ela estiver fora da tela. Respeitar "Reduzir movimento" do sistema (só um fade).

### 6. Participar de mais de uma família — FEITO no código (2026-11-11), falta aplicar migrations 099 + 101, publicar api/ e testar no aparelho
Ex.: a pessoa tem o grupo com esposa e filho E o grupo com os pais.
- [ ] Uma conta pode pertencer a mais de uma família (hoje `allowed_users` tem UMA linha por e-mail e `current_household()` devolve uma só).
- [ ] Ajustes: ver minhas famílias, trocar a família ativa, entrar em outra pelo código de convite, sair de uma.
- [ ] Notificações, widgets e Home seguem a família ativa (decidir: push de todas as famílias ou só da ativa).
Notas técnicas: é a mudança mais profunda da lista — toda RLS passa por `current_household()`. Caminho provável: tabela de vínculos (email, household_id, role) + "família ativa" por usuário (ex. em `user_settings`), e `current_household()` passa a ler a ativa. Os servidores (send-ping, digest, widget) que leem `allowed_users` por e-mail precisam ser revistos.

### 7. Anúncios nos jogos para o plano grátis (ideia do Arthur, a avaliar)
Plus sem anúncio; no grátis, um anúncio entre as rodadas / ao fim da partida (bom porque costuma ter 2+ pessoas olhando).
Antes de decidir:
- O `mobile/CLAUDE.md` tem a regra "não adicionar SDKs de anúncio/rastreamento" — para manter o app SEM o pedido de rastreamento da Apple (ATT) e com baixa exposição a COPPA. Mudar isso é decisão de produto.
- App de família com crianças: AdMob/Play exigem anúncios "child-directed" (menos rentáveis) e o Google Play "Families policy" se o público incluir menores; a Apple olha com rigor apps que podem ser usados por crianças.
- Rótulos de privacidade das lojas mudam (dados coletados por anúncio).
- Alternativa sem SDK: em vez de anúncio, um card "Jogue sem limites com o Plus" no fim da partida (house ad) — monetiza sem rastreamento.

