# AcodeCord

Mostra no seu status do Discord qual arquivo e linguagem você está editando no Acode.

Extensão open-source que exibe o que você edita no Acode diretamente no status do Discord via Rich Presence: arquivo, linguagem, tempo de sessão e projeto atual. (Está em beta, qualquer erro reporte pra mim. Informações no report.md).
 
## Como usar

1. Instale o plugin no Acode.
2. Abra a barra lateral (sidebar) e clique no ícone **AcodeCord**. Um painel de configurações abre ali, com:
   - Campo de **token** do Discord
   - Seletor de **status** (online / ausente / não perturbe / invisível)
   - Campos de **Application ID** e das **imagens** (opcional, veja seção abaixo)
   - Botão **Ligar/Desligar** e **Salvar configurações**
3. Preencha o token, clique em **Salvar configurações** e depois em **Ligar**.

Também dá pra ligar/desligar rapidamente pela paleta de comandos, com **"AcodeCord: ligar/desligar"**.

## Configurar as imagens (ícone grande/pequeno)

1. Vá em [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**. O nome dela vira o "nome" que aparece na presence.
2. Copie o **Application ID** (aba General Information).
3. No menu lateral, vá em **Rich Presence → Art Assets** e suba suas imagens (mínimo 512×512). Dê um nome simples e em minúsculas pra cada uma (ex: `acode_logo`) — esse nome é a *key* que você vai usar no painel.
4. Aguarde alguns minutos (o Discord demora um pouco pra processar o asset novo).
5. No painel do AcodeCord, preencha **Application ID**, **Large Image Key/Text** e, se quiser, **Small Image Key/Text**. Clique em **Salvar configurações**.

## Como pegar seu token (uso por sua conta e risco)

1. Abra o Discord no navegador (discord.com/app) e faça login.
2. Abra o DevTools (F12) → aba **Network**.
3. Filtre por `science` ou qualquer requisição para `discord.com/api`.
4. No cabeçalho da requisição, copie o valor de `authorization`.

⚠️ **Nunca compartilhe esse token.** Ele dá acesso total à sua conta.
Usar o token pessoal para automações não-oficiais tecnicamente viola os
Termos de Serviço do Discord (é uma forma de "self-bot"). É uma prática
comum e sem casos conhecidos de banimento por só atualizar presence,
mas o risco é seu.

## Limitações desta versão

- Imagens exigem uma aplicação própria no Discord Developer Portal (ver acima).
- Token é salvo em `localStorage` do WebView, sem criptografia extra.

## Créditos

Desenvolvido por **Black Solutions**.
Código aberto no GitHub — contribuições são bem-vindas.

## Licença

MIT License — Copyright (c) 2026 Black Solutions. Veja [LICENSE](./LICENSE).

## Repositório

https://github.com/ghosttobygg/acodecord