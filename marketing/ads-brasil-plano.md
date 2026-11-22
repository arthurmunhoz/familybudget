# One Roof: plano de anúncios no Brasil

Escrito em 22/11/2026. Base: a campanha dos EUA ("Busca US - One Roof", no ar
desde 21/11), os números do Posto Certo no Brasil e os dados de palavras-chave
já levantados (Apple Ads popularity + Google Trends).

## 0. Pré-requisito: a ficha em português

Hoje as duas lojas só têm a ficha em inglês. Quem busca "lista de compras" no
Brasil veria "One Roof: Family Organizer" e uma descrição em inglês, e isso
derruba a taxa de toque e de download. O texto em português já está pronto em
`mobile/STORE-LISTING-pt-es.md`.

- **App Store:** adicionar a localização "Portuguese (Brazil)" na versão 1.6.2,
  que está sendo preparada agora, antes de enviar para revisão (nome,
  subtítulo, descrição, palavras-chave, What's New). Sem prints próprios, a
  loja usa os prints em inglês. Prints em pt: `store/app-store-v3/shots/pt`
  (versão antiga) ou novos depois.
- **Google Play:** adicionar a tradução pt-BR na ficha principal (não depende
  de versão).

Sem isso, não vale gastar.

## 1. Apple Ads, Busca no Brasil (fase 1)

| | |
|---|---|
| Campanha | "Busca BR - One Roof", só Brasil, Search Results |
| Orçamento | US$ 3/dia (teto ~US$ 90/mês) |
| Lance | manual, padrão US$ 0,40 (o Posto Certo paga ~US$ 0,29 por toque no BR) |
| Search Match | DESLIGADO (no Posto Certo, 75% das impressões vieram de termos errados) |
| Palavras (EXATAS) | `lista de compras` (a única com volume real: Trends 70), `lista de mercado`, `lista de compras compartilhada`, `agenda familiar`, `organizador familiar`, `calendário compartilhado`, `calendário familiar`, `app de casal` |
| Fora por enquanto | `controle de gastos` / `controle financeiro` (volume bom, mas intenção de app de finanças: público errado e caro) |
| Negativas | concorrentes e confusões: cozi, familywall, timetree, listonic, bring, google agenda, mercado livre, ifood, rappi, nota fiscal, cpf na nota, supermercado (nome de rede), receita, cardápio |

Revisão: aba Search Terms aos 7 dias; veredito aos 14 dias.

**Corte:** palavra com US$ 5 gastos e nenhuma instalação é pausada.
**Meta:** CPA ≤ US$ 1,50 (o BR é mais barato que os EUA; o Posto Certo fica
em ~US$ 0,41–1,06).

## 2. Medir o que importa

- Instalações (Apple Ads mostra sozinho).
- Famílias criadas por dia no Brasil (Supabase: `households` +
  `user_settings.language = 'pt'`) contra a média antes da campanha.
- Trials que viram Plus. Hoje são **0 assinaturas pagas** no total, então a
  fase 1 compra aprendizado, não lucro.

## 3. Depois (só se a fase 1 der certo)

- **Google Play / Android** (80% do Brasil): Google App Campaigns, a partir de
  R$ 20/dia. Precisa de conversão configurada (Firebase/GA4 for Firebase no
  app), o que hoje não existe; é trabalho de app e uma decisão de
  privacidade.
- **Meta/Instagram:** só com um vídeo que já tenha ido bem no orgânico
  (TikTok @one.roof.app); boost pequeno (R$ 15/dia), público "pais e mães
  25–45".
- **Subir o orçamento** só depois de aparecer a primeira assinatura vinda do
  Brasil.

## Ordem

1. Ficha pt-BR na App Store (junto com a 1.6.2) e no Play.
2. Com a 1.6.2 publicada, criar a campanha BR (US$ 3/dia).
3. Revisar Search Terms em 7 dias; dar o veredito em 14.
4. Decidir sobre Android/Meta com os números na mão.
