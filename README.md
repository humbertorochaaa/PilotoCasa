# Despensa — piloto da casa

Protótipo para acompanhar compras, consumo e reposição durante um piloto de 35 dias.

## Leitura das notas

Em qualquer dispositivo, use **Enviar foto** para selecionar uma imagem. O app procura o QR code e usa OCR em português para sugerir mercado, data e itens. Ao usar **Escanear nota**, enquadre a nota inteira e mantenha o QR visível: a câmera lê o QR e tenta reconhecer o texto no mesmo quadro. O QR identifica a consulta fiscal; os produtos e o estabelecimento são reconhecidos pelo texto da nota. Antes de preencher os itens, o app confere a quantidade lida e compara a soma dos produtos com o total impresso. Se a conta não bater, ele deixa os itens em branco para evitar salvar valores incorretos. Se a câmera não reconhecer a tabela inteira, use **Usar foto** para escolher uma imagem mais nítida. No desktop, **Enviar PDF** procura o QR code nas primeiras dez páginas. Confira os campos reconhecidos antes de salvar.

As imagens são processadas no aparelho e não são enviadas nem guardadas. O OCR e a leitura de QR precisam de internet para carregar as bibliotecas; o progresso e qualquer falha aparecem no formulário.

## Banco compartilhado, logins e administração

Sem Supabase configurado, o piloto continua no modo local: as notas ficam só naquele navegador. O banco compartilhado ativa login por e-mail, sincronização entre participantes, seleção de meses anteriores, auditoria e exclusão administrativa de notas.

1. No Supabase, copie a **Project URL** e a chave pública **Publishable** (ou a chave pública `anon` em projetos antigos). Coloque os valores em `supabase-config.js`. Nunca coloque uma `service_role` ou chave `secret` nesse arquivo.
2. A integração GitHub já está configurada para este repositório, diretório `.` e branch `main`. Ao receber este commit, ela deve aplicar `supabase/migrations/20261115190000_shared_beta_schema.sql` e publicar a Edge Function declarada em `supabase/config.toml`.
3. No Supabase, abra **Authentication → Users** e crie seu usuário administrador com seu e-mail e uma senha temporária privada. Depois abra **SQL Editor**, copie `supabase/bootstrap-admin.sql`, troque `SEU_EMAIL_AQUI` pelo e-mail do administrador e execute uma vez.
4. Abra `index.html`, entre com e-mail e senha, e defina sua nova senha. Depois abra `admin.html` e use **Criar login** para adicionar participantes. A senha temporária é entregue diretamente à pessoa; no primeiro acesso, ela terá de escolher outra senha. O painel permite editar usuário, e-mail e senha temporária, remover participantes, auditar mudanças e excluir notas.

O site usa o usuário conectado para identificar a casa; tabelas são protegidas por Row Level Security. A chave administrativa fica apenas no servidor Supabase. O histórico de recibos é compartilhado em uma linha por casa, e alterações nas notas são registradas em auditoria sem guardar as imagens.

## Uso local

Abra `index.html` em um navegador moderno. Para câmera, use o site HTTPS. Confira os itens antes de salvar e use o mesmo nome para acompanhar o intervalo de reposição. No modo local, exporte os registros em CSV pelo botão no menu lateral.

