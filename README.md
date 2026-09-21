# Duck of Duty

Um jogo de caça aos patos controlado **só com o rosto**, direto no navegador. Não usa mouse nem teclado.

Você mira com os olhos e a cabeça, atira fechando os olhos e recarrega olhando para a caixa de munição. A webcam lê o seu rosto com o [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker), e tudo roda no seu computador.

> **Sua privacidade:** a imagem da câmera é processada localmente, no próprio navegador. Nada é gravado nem enviado para lugar nenhum. A internet só é usada para baixar o modelo de detecção de rosto.

---

## Do que você precisa

| Item | Detalhe |
|---|---|
| **Computador com webcam** | Notebook ou webcam USB. Quanto melhor a câmera e a luz, melhor a mira. |
| **Google Chrome ou Microsoft Edge** | Atualizados. Outros navegadores podem não funcionar. |
| **Node.js 20.19 ou mais novo** (recomendado: 22 LTS) | Baixe em <https://nodejs.org> e instale com as opções padrão. |
| **Git** | Baixe em <https://git-scm.com>. Opcional: dá para baixar o ZIP, veja abaixo. |
| **Internet** | Na primeira vez, para instalar as dependências e baixar o modelo de rosto. |

Para conferir se o Node e o Git estão instalados, abra um terminal e rode os dois comandos abaixo. Cada um deve mostrar um número de versão.

- **Windows:** PowerShell ou Prompt de Comando.
- **Mac e Linux:** Terminal.

```bash
node -v
```

```bash
git --version
```

---

## Como jogar na sua máquina

### 1. Baixe o projeto

Com Git:

```bash
git clone https://github.com/GuilhermeHMaia/duck-of-duty-gm.git
```

```bash
cd duck-of-duty-gm
```

Sem Git:

1. Na página do repositório no GitHub, clique em **Code → Download ZIP**.
2. Extraia o arquivo.
3. Abra o terminal dentro da pasta extraída.

### 2. Instale as dependências (só na primeira vez)

```bash
npm install
```

### 3. Inicie o jogo

```bash
npm run dev
```

O terminal vai mostrar um endereço como `http://localhost:5173/`.

1. Abra esse endereço no **Chrome** ou no **Edge**.
2. Quando o navegador pedir, **permita o uso da câmera**.

> Deixe o terminal aberto enquanto joga. Para encerrar, volte nele e aperte `Ctrl + C`.

### 4. Primeira vez: o jogo te guia

1. **Boas-vindas:** mostra os controles. Antes de clicar em **Começar**, aperte **F11** para ficar em tela cheia (explicação logo abaixo).
2. **Prepare-se:** a tela mostra a sua câmera e confere se está tudo certo: rosto encontrado, centralizado, na distância certa, com luz boa e câmera fluida. Arrume o que estiver em amarelo e clique em **Calibrar a mira**.
3. **Estande de Treino (calibração, cerca de 1 minuto):** aparecem 18 alvos, um de cada vez. Para cada alvo:
   - Olhe para o **centro do alvo** mexendo **só os olhos**, com a cabeça parada.
   - Espere meio segundo.
   - **Feche os dois olhos por um instante.** O alvo cai.

   Se o alvo não cair, aparece uma dica do que ajustar.
4. **Missão tutorial no Lago do Vovô:** o Sargento Bico-de-Aço ensina o resto na prática.

> **Por que tela cheia antes de calibrar?** A calibração vale para o tamanho de janela em que foi feita. Se a janela mudar de tamanho depois (entrar ou sair da tela cheia, redimensionar), ela é apagada e você precisa recalibrar pelo menu.

### Nas próximas vezes

Basta abrir o terminal na pasta do projeto, rodar `npm run dev` e abrir o endereço. O progresso e a calibração ficam salvos no navegador.

Para pegar a versão mais nova do jogo:

```bash
git pull
```

```bash
npm install
```

---

## Controles

| Ação | Como fazer |
|---|---|
| **Mirar** | Olhe para onde quer mirar. Virar a cabeça também move a mira. |
| **Atirar** | Feche os **dois olhos** por um instante (mais longo que uma piscada normal). |
| **Recarregar** | Olhe para a **caixa de munição** (canto de baixo, à direita) por meio segundo. Ou feche só o **olho esquerdo** por um instante. |
| **Trocar de arma** | Feche só o **olho direito** por um instante. |
| **Super "Rajada"** | **Abra a boca** para carregar. Quando estiver cheio, feche os olhos para disparar. |
| **Escolher nos menus** | Olhe para um botão: a mira trava nele (fica verde) e não escapa com o tremor. Feche os olhos por um instante para escolher. O mouse também funciona. |
| **Recentralizar a mira** | Em **Mira livre**, olhe o alvo do centro e levante as sobrancelhas por 1 segundo (ou aperte `C`). |

Teclas de apoio:

- `Esc`: sai da partida.
- `M`: liga e desliga o som.
- `D`: abre o painel técnico.

> **Dica do tiro:** o anel em volta da mira enche enquanto você mantém a mira num pato. Quando ficar **verde**, feche os olhos para atirar.

---

## O jogo

- **Carreira:** três regiões, cada uma com 4 missões e 3 estrelas por missão.
  - **Lago do Vovô**.
  - **Floresta Noturna**: seu olhar é a lanterna.
  - **Pântano da Neblina**: a névoa só abre onde você olha. No fim, o chefe **General Grasnado**: encare o olho dele sem piscar para abrir o escudo.
- **Desafio Diário:** um desafio novo por dia, o mesmo para todo mundo.
- **Treino Livre:** 5 rodadas valendo recorde.
- **Arsenal:** Espingarda do Vovô, Escopeta e Rifle de Precisão, com melhorias compradas com penas.
- **Conquistas:** 11 para desbloquear.
- **Configurações:** ajustes simples que valem na hora.

| Ajuste | O que faz |
|---|---|
| Sensibilidade da cabeça | Quanto a mira anda quando você vira a cabeça. |
| Peso dos olhos | Quanto o olhar move a mira. **Se a mira tremer muito, abaixe.** |
| Estabilidade da mira | Treme menos, mas responde um pouco mais devagar. |
| Sensibilidade do piscar | Se o tiro não sai, aumente. Se atira sozinho, diminua. |
| Sensibilidade do wink | Para recarregar e trocar de arma. |
| Ímã da mira | Quanto a mira gruda nos patos. |

---

## Deu problema?

| Sintoma | O que fazer |
|---|---|
| **"O acesso à câmera foi bloqueado"** | Clique no ícone de câmera ou de cadeado na barra de endereço, permita a câmera e clique em **Tentar de novo**. |
| **A imagem da câmera é de outro dispositivo, fica laranja ou preta** | Você deve ter uma câmera virtual instalada (DroidCam, OBS, etc.). No Chrome, abra `chrome://settings/content/camera`, escolha a webcam de verdade e recarregue a página. |
| **"A câmera está ocupada"** | Feche Teams, Zoom, OBS ou outra aba usando a câmera. |
| **Mira tremendo** | Melhore a luz no rosto (luz de frente, não atrás de você). Em **Configurações**, abaixe o **Peso dos olhos** ou aumente a **Estabilidade**. |
| **Mira desviada para um lado** | Use **Mira livre → Recentralizar**. Se não resolver, **Recalibrar**. |
| **O tiro não sai** ou **atira sozinho** | Ajuste a **Sensibilidade do piscar** em Configurações. |
| **"A janela mudou de tamanho e a calibração foi apagada"** | Deixe a janela do jeito que vai jogar (de preferência em tela cheia, com F11) e clique em **Recalibrar**. |
| **Câmera lenta (poucos FPS)** | Mais luz ajuda muito, porque câmeras reduzem o FPS no escuro. Feche outros programas pesados. |
| **Aparece "Não foi possível iniciar"** | Confira a internet: o modelo de rosto é baixado na primeira vez. |
| **`npm` não é reconhecido** | O Node.js não está instalado ou o terminal foi aberto antes da instalação. Instale e abra um terminal novo. |

**Para começar do zero** (apagar progresso, calibração e ajustes):

1. Abra o DevTools com `F12`.
2. Vá em **Application → Local storage → http://localhost:5173**.
3. Apague as chaves que começam com `duck-of-duty`.

---

## Para desenvolvedores

Feito com TypeScript, Vite, `@mediapipe/tasks-vision` e Canvas 2D, sem frameworks e sem backend. Tudo fica salvo no `localStorage`.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga automática. |
| `npm run build` | Checagem de tipos e build de produção em `dist/`. |
| `npm run preview` | Serve o build de produção localmente. |

```
src/
  main.ts            loop de tracking e render, navegação entre telas
  tracking/          MediaPipe, piscadas e winks, pose da cabeça, filtros 1€
  calibration/       Estande de Treino e regressão ridge do olhar
  game/              mira (fusão olho + cabeça), patos, chefe, armas, sons
  career/            missões, história, progresso, conquistas, desafio diário
  scenes/            telas (boas-vindas, preparo, menu, mapa, briefing, resultado, arsenal, configurações...)
  settings/          ajustes salvos, níveis do menu Configurações e primeira vez guiada
  debug/             painel técnico (tecla D)
```

A câmera só funciona em `localhost` ou em HTTPS. Para jogar pela rede em outro aparelho seria preciso servir com HTTPS.
