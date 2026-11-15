# Despensa — piloto da casa

Protótipo privado para registrar as compras da casa durante um piloto de 35 dias.

## Abrir

Abra `index.html` em um navegador moderno. Em qualquer dispositivo, **Enviar foto** permite escolher uma imagem da nota; o OCR tenta reconhecer o estabelecimento e os itens e o leitor procura o QR code. No computador, **Enviar PDF** procura o QR nas primeiras dez páginas. No celular, **Escanear nota** abre a câmera; autorize o acesso quando o navegador pedir. Para usar a câmera, o site precisa estar aberto por HTTPS.

## Como usar

1. Adicione uma compra e informe mercado, data e itens.
2. Confira quantidade, unidade, preço total e categoria de cada item.
3. Use o mesmo nome para o mesmo produto em compras diferentes para acompanhar o intervalo de reposição.
4. Exporte os registros em CSV pelo botão no menu lateral.

O QR code identifica e guarda a chave/link da consulta. Fotos e PDFs são processados no navegador e não são armazenados. Na foto, o OCR preenche os campos que conseguir reconhecer; revise e corrija antes de salvar. O envio de PDF procura o QR code, e os itens ainda são conferidos e registrados no formulário. O leitor usa jsQR, PDF.js e Tesseract.js carregados pelo jsDelivr; os arquivos continuam no dispositivo.

## Dados e privacidade

As notas ficam no armazenamento local do navegador e não são enviadas a um servidor. O histórico fica disponível somente nesse navegador e dispositivo. O CSV exportado é salvo no computador. Não registre CPF no campo do QR code.

