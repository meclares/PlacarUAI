# Supabase, assinaturas e painel master

## Estrutura encontrada e alteracoes

O projeto original nao continha migracoes, esquema de banco, autenticao remota ou integracao de pagamentos. As contas, senhas antigas e campeonatos eram armazenados no navegador. Nenhuma tabela preexistente foi reutilizada.

A migracao `migrations/20261101120000_subscriptions_and_master.sql` cria:

- `profiles`: perfil associado ao UUID do Supabase Auth; o e-mail e somente um atributo, nunca uma chave de relacionamento.
- `tournaments`: campeonato, organizador, publicacao, estado, datas, participantes e payload completo de resultados.
- `subscriptions` e `payments`: vigencia, estado confirmado pelo provedor, identificadores externos e historico financeiro. Nenhum dado de cartao e armazenado.
- `match_history`: historico privado por usuario.
- `app_private.admin_roles` e `admin_audit_logs`: permissao master fora do fluxo de cadastro e trilha de auditoria imutavel.
- `system_events`: falhas de checkout/cancelamento e verificacao de webhooks, com identificacao automatica e revisao manual auditada.
- `can_manage_tournaments`, `is_current_user_master`, `admin_metrics` e `admin_search_users`: verificacoes e consultas protegidas.

A migracao `migrations/20261102210000_social_profiles_and_activity.sql` acrescenta:

- `athlete_follows`: relacoes entre atletas, sem permitir entrar na propria Arquibancada ou duplicar acompanhamentos.
- `social_matches` e `social_match_participants`: partidas compartilhadas e aceite individual dos participantes.
- `social_notifications`: avisos de entrada na Arquibancada, convite de partida e atividade concluida.
- RPCs para buscar perfis, consultar apenas os campos publicos, acompanhar atletas, responder a convites e abrir o feed da Arquibancada. As tabelas sociais nao permitem leitura ou escrita direta por `anon`/`authenticated`; as RPCs de perfis e conexoes exigem uma conta autenticada e limitam os dados devolvidos.

A migracao `migrations/20261103000000_social_tournament_feed.sql` cria indices de busca por ID/nome e inclui no feed da Arquibancada os campeonatos concluidos e publicados pelos atletas acompanhados.

A migracao `migrations/20261103024500_authenticated_app_access.sql` restringe a busca/consulta de perfis, conexoes sociais e consulta de campeonatos publicados a sessoes autenticadas. Somente o placar pode ser usado sem conta; o historico, perfil, recursos sociais e campeonatos exigem login.

## Cadastro seguro e e-mails

O cadastro por e-mail aguarda a confirmacao antes de liberar a sessao. A pagina inicial e o formulario de conta do placar oferecem reenvio do link; a recuperacao usa uma resposta generica para nao revelar se o e-mail possui cadastro. As telas aceitam senhas com no minimo 8 caracteres.

Para Supabase local, `config.toml` ativa a confirmacao, define a validade dos links em uma hora e associa os templates:

- `templates/confirmation.html` para o template **Confirm signup**.
- `templates/recovery.html` para o template **Reset password**.

Em producao, aplique as mesmas opcoes em **Authentication > Providers > Email**: habilite **Confirm email**, defina o minimo de 8 caracteres e configure a validade do OTP para 3600 segundos. Em **URL Configuration**, use o dominio HTTPS publicado como **Site URL** e permita os enderecos de retorno de `PlacarUai.html` e `index.html?recovery=1`. Copie os assuntos e o conteudo dos dois arquivos de template para **Email Templates**. Ao abrir o app por `file://`, o cliente nao envia um endereco de retorno local invalido e usa o **Site URL** configurado no Supabase.

Antes do lancamento, configure um SMTP proprio em **Authentication > SMTP Settings**, com remetente do dominio, protecao contra senhas vazadas e limites adequados para tentativas de cadastro/login. O SMTP gratuito padrao do Supabase e destinado a testes; nenhum segredo SMTP deve ser colocado no cliente ou no repositorio. A expiracao de OTP e compartilhada pelo Supabase entre os fluxos; uma hora atende ao limite de 24 horas da confirmacao e ao prazo de uma hora da recuperacao.

## Autorizacao e RLS

As politicas permitem leitura de campeonatos publicados somente a usuarios autenticados; a publicacao continua controlada pelo organizador. O organizador pode consultar seu proprio historico mesmo sem assinatura. Insercao e alteracao de campeonatos exigem simultaneamente o UUID do organizador autenticado, conta ativa e uma assinatura paga cujo periodo ainda nao venceu. As tabelas de pagamentos e assinaturas sao somente leitura para usuarios; somente as Edge Functions atualizam esses estados. Perfis sociais sao consultados por funcoes que nao retornam e-mail; partidas compartilhadas so entram no historico e no feed quando nao ha convites pendentes.

Cancelamento preserva o acesso ate o final do periodo pago. Vencimento, cancelamento e falha de renovacao nao removem campeonatos, partidas, resultados ou classificacoes. Nao ha operacao de exclusao de campeonato exposta a usuarios.

## Permissao master

O painel esta em `../admin.html`, fora da navegacao comum. A pagina exige Supabase Auth e cada consulta chama a Edge Function `admin-dashboard`, que verifica `is_current_user_master()` antes de ler dados com o cliente administrativo. A verificacao no navegador nao concede permissao.

Cadastre o primeiro master somente depois de criar e confirmar a conta no Supabase Auth. No SQL Editor do projeto, associe o UUID de Auth obtido no painel:

```sql
insert into app_private.admin_roles (user_id, reason)
values ('<UUID_DO_USUARIO_AUTH>', 'Concessao inicial do administrador master');
```

Uma conta comum nao tem permissao de escrita nessa tabela. A funcao de dashboard consulta metricas, usuarios, assinaturas, pagamentos, campeonatos e auditoria de fontes reais. O painel nao permite alteracoes financeiras ou de resultados; isso evita uma ferramenta de ajuste privilegiado sem um fluxo de aprovacao/auditoria apropriado.

## Mercado Pago

A integracao usa assinatura recorrente mensal de R$ 49,90 por meio de `preapproval`. A autorizacao de cobranca, por si so, nao ativa o gerenciamento: uma cobranca aprovada, em BRL e no valor esperado, precisa ser confirmada ao consultar a API do Mercado Pago. O vencimento usa a proxima data de cobranca informada pelo provedor; o fallback de um mes e calculado a partir da data de aprovacao quando o provedor nao retorna essa data.

O endpoint `mercadopago-webhook` e publicamente acessivel para receber callbacks, conforme autorizado, mas valida a assinatura HMAC do Mercado Pago e consulta a API do provedor antes de aplicar qualquer mudanca. Configure os eventos `payment`, `subscription_preapproval` e `subscription_authorized_payment`. Repeticoes de notificacao atualizam registros usando identificadores externos unicos.

## Configuracao e deploy manual

1. Configure a URL do projeto e a chave publica `sb_publishable_...` em `../supabase-client-config.js`. A chave publishable e apropriada para o navegador; nunca coloque chaves `sb_secret_...`, tokens do Mercado Pago ou senhas nesse arquivo.
2. Vincule o Supabase CLI ao projeto e aplique as migracoes com `supabase db push`.
3. Configure os segredos no ambiente Supabase, sem os salvar no repositorio:

   ```text
   MERCADOPAGO_ACCESS_TOKEN
   MERCADOPAGO_WEBHOOK_SECRET
   MERCADOPAGO_WEBHOOK_URL
   PLACARUAI_APP_URL
   ```

4. Implante as funcoes `create-subscription`, `cancel-subscription`, `mercadopago-webhook` e `admin-dashboard`.
5. Configure as URLs de redirecionamento e os templates de autenticacao conforme **Cadastro seguro e e-mails**. Enquanto o site nao tiver dominio, use `http://127.0.0.1:8765` como Site URL e permita `http://127.0.0.1:8765/**`; ao publicar, substitua pelo dominio HTTPS e permita as URLs de `PlacarUai.html` e `index.html?recovery=1` nesse dominio. Para Google, habilite o provedor em Auth > Providers, configure Client ID e Client Secret e cadastre no Google Cloud o callback `https://fowkevxjdtjglgtsnkcz.supabase.co/auth/v1/callback`. Cadastre a URL de webhook da funcao no painel do Mercado Pago e habilite os eventos acima.
6. Publique `index.html`, `index-app.js`, `favicon.svg`, `assets/hero-tennis.webp`, `duvidas.html`, `robots.txt`, `PlacarUai.html`, `supabase-app.js`, `social-app.js`, `supabase-client-config.js`, `admin.html`, `admin-dashboard.js`, `campeonatos.html` e `public-tournaments.js` no mesmo site HTTPS. O endereco canonico da pagina inicial e relativo a raiz do site; depois de definir o dominio, configure os enderecos canonicos e `og:url` absolutos e publique um sitemap com esse dominio.
7. Cadastre o master por UUID, conforme a secao anterior.

Os segredos de producao e a conectividade do projeto Supabase/Mercado Pago dependem de configuracao externa. Nenhuma chave privada foi adicionada ao navegador ou ao repositorio.

## Importacao do armazenamento local

Com uma conta autenticada, use **Exportar dados locais** para baixar um JSON contendo somente o perfil associado ao e-mail atual, partidas pessoais atribuiveis a essa conta e campeonatos da conta no servidor. A exportacao nao inclui senhas, tokens ou credenciais locais.

Em cada navegador/dispositivo que tenha dados antigos, entre com a conta proprietaria e use **Importar dados locais**. A importacao de campeonatos exige confirmacao de propriedade e uma assinatura ativa; o banco define o usuario autenticado como organizador e mantem o payload original. Perfis e partidas pessoais permanecem privados. Campeonatos importados ficam privados ate serem publicados pelo organizador.

O navegador remove os campos de senha legados de `localStorage` ao carregar a integracao. Os dados locais nao sao apagados automaticamente.

## Testes e limitacoes de ambiente

Validacao de sintaxe JavaScript e verificacoes estaticas devem ser executadas antes do deploy. Este repositorio nao fornece projeto Supabase local, credenciais de teste ou credenciais do Mercado Pago; por isso, migracao de banco, RLS em runtime, notificacoes, cobrancas reais e cenarios multiusuario precisam ser validados no projeto de homologacao antes de producao.

Nunca use os segredos de producao para validar a integracao. Confirme tambem a rotacao e remocao de credenciais antigas que tenham sido armazenadas em arquivos locais ou no historico do Git.
