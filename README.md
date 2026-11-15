# Despensa — piloto da casa

Protótipo privado para registrar as compras da casa durante um piloto de 35 dias.

## Abrir

Abra `index.html` em um navegador moderno. No botão **Escanear nota**, o formulário e o leitor de QR abrem juntos. Autorize o acesso à câmera quando o navegador pedir. No celular, o site precisa estar aberto por HTTPS; navegadores bloqueiam a câmera em páginas locais abertas diretamente pelo arquivo. Como alternativa, use **Ler uma imagem** ou cole o link ou a chave no formulário.

## Como usar

1. Adicione uma compra e informe mercado, data e itens.
2. Confira quantidade, unidade, preço total e categoria de cada item.
3. Use o mesmo nome para o mesmo produto em compras diferentes para acompanhar o intervalo de reposição.
4. Exporte os registros em CSV pelo botão no menu lateral.

O QR code identifica e guarda a chave/link da consulta. Neste piloto, os itens da nota são conferidos e registrados no formulário. A leitura automática da lista de produtos depende de integrar a consulta da NFC-e, que pode variar conforme a página e o acesso disponibilizado. O leitor de câmera usa a biblioteca jsQR, carregada pelo jsDelivr, e processa as imagens no próprio navegador.

## Dados e privacidade

As notas ficam no armazenamento local do navegador e não são enviadas a um servidor. O histórico fica disponível somente nesse navegador e dispositivo. O CSV exportado é salvo no computador. Não registre CPF no campo do QR code.

