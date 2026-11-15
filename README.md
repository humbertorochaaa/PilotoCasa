# Despensa — piloto da casa

Protótipo para acompanhar compras e reposição durante um piloto de 35 dias.

## Leitura das notas

Em qualquer dispositivo, use **Enviar foto** para selecionar uma imagem. O app procura o QR code e usa OCR em português para sugerir mercado, data e itens. No desktop, **Enviar PDF** procura o QR code nas primeiras dez páginas. No celular, **Escanear nota** abre a câmera. Confira os campos reconhecidos antes de salvar.

As imagens são processadas no aparelho e não são enviadas nem guardadas. O OCR e a leitura de QR precisam de internet para carregar as bibliotecas; o progresso e qualquer falha aparecem no formulário.

## Beta compartilhado e administração

Sem uma configuração Supabase, o piloto continua no modo local: as notas ficam só naquele navegador. Para duas ou mais pessoas verem o mesmo histórico e usar logins, configure um projeto Supabase:

1. Crie um projeto no Supabase e copie a **Project URL** e a chave **anon/publishable** para `supabase-config.js`. Essa chave pública é protegida pelas políticas de acesso do banco. Nunca coloque uma `service_role` ou `secret key` nesse arquivo.
2. No painel do Supabase, abra **SQL Editor** e execute `supabase/schema.sql`.
3. Crie seu próprio usuário em **Authentication → Users**. Em `supabase/bootstrap-admin.sql`, troque `SEU_EMAIL_AQUI` pelo e-mail exato e rode esse arquivo uma vez.
4. Em **Authentication → URL Configuration**, use `https://humbertorochaaa.github.io/PilotoCasa/` como Site URL e permita `https://humbertorochaaa.github.io/PilotoCasa/?flow=invite` como Redirect URL.
5. Instale/abra a Supabase CLI, conecte o projeto e publique `supabase/functions/admin-create-user`. Configure `APP_URL=https://humbertorochaaa.github.io/PilotoCasa/?flow=invite` como secret da função. A função usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor Supabase.
6. Configure o provedor de e-mail no Supabase. Entre em `admin.html` com seu login, envie o convite ao participante e acompanhe as alterações na área **Auditoria**.

O convite cria uma conta de participante e concede acesso ao histórico da casa; no primeiro acesso, a pessoa define a própria senha. O site usa a sessão Supabase e grava as compras em uma linha compartilhada, protegida por Row Level Security. Se já houver compras locais no navegador do administrador e o histórico compartilhado estiver vazio, elas são migradas no primeiro login. A auditoria registra convites e IDs de notas adicionadas, alteradas ou removidas; não guarda foto da nota.

## Uso local

Abra `index.html` em um navegador moderno. Para câmera, use o site HTTPS. Confira os itens antes de salvar e use o mesmo nome para acompanhar o intervalo de reposição. No modo local, exporte os registros em CSV pelo botão no menu lateral.

