# Despensa — piloto da casa

Protótipo privado para registrar as compras da casa durante um piloto de 35 dias.

## Abrir

Abra `index.html` em um navegador moderno. Para usar a câmera do leitor de QR code, abra o site por `http://localhost` ou HTTPS; navegadores bloqueiam acesso à câmera em páginas locais abertas diretamente pelo arquivo. Como alternativa, cole o link ou a chave no formulário.

## Como usar

1. Adicione uma compra e informe mercado, data e itens.
2. Confira quantidade, unidade, preço total e categoria de cada item.
3. Use o mesmo nome para o mesmo produto em compras diferentes para acompanhar o intervalo de reposição.
4. Exporte os registros em CSV pelo botão no menu lateral.

O QR code identifica e guarda a chave/link da consulta. Neste piloto, os itens da nota são conferidos e registrados no formulário. A leitura automática da lista de produtos depende de integrar a consulta da NFC-e, que pode variar conforme a página e o acesso disponibilizado.

## Dados e privacidade

As notas ficam no armazenamento local do navegador e não são enviadas a um servidor. O histórico fica disponível somente nesse navegador e dispositivo. O CSV exportado é salvo no computador. Não registre CPF no campo do QR code.

