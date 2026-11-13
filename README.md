# Registro de Horas

Aplicativo desktop para registrar as horas trabalhadas, acompanhar a meta mensal de cada empresa e saber, enquanto o dia é preenchido, a que horas é possível sair mais cedo ou é preciso sair mais tarde.

- Funciona offline: não há servidor, conta ou envio de dados. A única conexão é a consulta de novas versões no GitHub ao abrir.
- Os registros ficam somente no computador de quem usa, cifrados com uma senha definida na primeira abertura.
- Várias empresas, cada uma com sua meta e jornada — útil ao trocar de trabalho ou ter mais de um.

## Instalação (Windows)

1. Baixe o arquivo `Registro-de-Horas-Setup-X.Y.Z.exe` na página de [Releases](../../releases/latest).
2. Execute o instalador e siga os passos. Não é necessário ser administrador.
3. Abra o **Registro de Horas** pelo menu Iniciar ou pelo atalho da área de trabalho.

O instalador não é assinado digitalmente, então o Windows SmartScreen pode exibir um aviso: escolha "Mais informações" e "Executar assim mesmo".

### Atualizações

A instalação manual só é necessária uma vez. A cada abertura, o aplicativo consulta a release mais recente deste repositório, baixa a nova versão em segundo plano e a instala ao ser fechado. Um aviso com o botão "Reiniciar e atualizar" permite aplicar na hora. Sem internet, a verificação é ignorada e o aplicativo abre normalmente.

Na primeira abertura:

1. Crie a senha do aplicativo (mínimo de 6 caracteres). Ela será pedida sempre que o aplicativo abrir.
2. Anote o **código de recuperação** exibido em seguida. Ele aparece uma única vez e é a única forma de recuperar os registros se a senha for esquecida.
3. Cadastre uma ou mais empresas, cada uma com as horas a cumprir por mês (padrão **152:00**, com jornada de **08:00** por dia).

## Funcionalidades

- **Senha**: tela de senha ao abrir, botão "Bloquear", troca de senha e recuperação por código.
- **Empresas**: cadastre quantas quiser, inclusive várias em sequência, e alterne entre elas. Cada uma guarda sua meta mensal, jornada diária, almoço padrão e registros.
- **Visão geral**: com duas ou mais empresas, uma tabela mostra meta, horas trabalhadas, quanto falta e saldo de cada uma no mês, com o total.
- **Meta só de um mês**: ajuste a meta de um mês específico (por exemplo, o mês de entrada ou de saída da empresa) sem mudar a meta padrão.
- **Registro diário**: entrada, saída para o almoço, retorno e saída. O almoço é opcional.
- **Almoço**: a duração registrada aparece em cada dia e somada no mês, e não conta como hora trabalhada. Durante o almoço, o painel "Hoje" mostra o retorno previsto.
- **Resumo do mês**: trabalhado, quanto falta para a meta, saldo (banco) frente à jornada diária e projeção de fechamento.
- **Previsão do dia**: ao digitar a entrada, cada campo ainda vazio mostra o horário previsto (saída para o almoço, retorno e saída) para fechar a jornada, e a previsão se ajusta a cada horário informado. O painel "Hoje" mostra também as horas trabalhadas até agora e como o mês fica se o dia fechar como previsto.
- **Painel "Hoje"**: com a entrada preenchida, mostra a saída para cumprir a jornada e a saída ajustada pelo saldo acumulado — mais cedo se o saldo é positivo, mais tarde se é negativo. Enquanto o retorno do almoço não é informado, considera o almoço padrão.
- **Feriados**: os feriados nacionais do Brasil são identificados automaticamente, inclusive os móveis (Sexta-feira Santa), e não contam como dia útil na meta. Carnaval e Corpus Christi (pontos facultativos) podem ser incluídos por empresa.
- **Bandeja do sistema**: ao minimizar, o aplicativo fica no ícone ao lado do relógio, sem ocupar a barra de tarefas. Um clique reabre a janela; o botão direito oferece Abrir, Bloquear e Sair. Fechar a janela (X) encerra o aplicativo.
- **Calendário destacado**: fins de semana, feriados e o dia de hoje aparecem em cores diferentes.
- **Média necessária**: horas por dia útil restante para fechar a meta.
- **Validação**: aponta horários fora de ordem ou incompletos em cada dia.
- **Tipos de dia**: trabalho, feriado/folga (não conta) e abono/atestado (credita a jornada diária).
- **Backup**: exportação/importação em JSON (todas as empresas) e exportação do mês em CSV. Os arquivos exportados não são cifrados.

## Onde ficam os dados

No aplicativo instalado, em `%APPDATA%\Registro de Horas\dados.json` (o caminho exato aparece no rodapé da seção "Empresa e metas"). A cada gravação, a versão anterior é mantida em `dados.json.bak`. Desinstalar o programa não apaga esses arquivos.

### Como a senha protege os dados

- O conteúdo é cifrado com AES-256-GCM por uma chave aleatória.
- Essa chave é guardada cifrada duas vezes: por uma chave derivada da senha e por outra derivada do código de recuperação, ambas com scrypt.
- Nem a senha nem o código são armazenados. Sem um dos dois, não há como ler os registros.
- A chave fica apenas na memória enquanto o aplicativo está desbloqueado.
- Tentativas erradas seguidas sofrem atraso crescente.

A proteção vale para o arquivo em disco. Ela não protege contra alguém com acesso ao computador enquanto o aplicativo está aberto e desbloqueado. A versão para navegador (`npm run web`) é voltada ao desenvolvimento e não tem senha.

Este repositório contém apenas código: nenhum registro de horas faz parte dele, e o `.gitignore` bloqueia arquivos de dados e de backup.

## Regras de cálculo

| Item | Regra |
| --- | --- |
| Almoço | `retorno − saída almoço` |
| Total do dia | `(saída − entrada) − almoço` |
| Saldo do dia | total − jornada diária (em fins de semana e feriados, tudo conta como extra) |
| Faltam | meta do mês − trabalhado |
| Dias úteis restantes | dias de segunda a sexta que não são feriado, de hoje em diante, ainda não concluídos e não marcados como folga/abono |
| Projeção | trabalhado + dias úteis restantes × jornada diária |

Feriados estaduais e municipais não são detectados: marque o dia como **Feriado/Folga**. Se a empresa não segue os feriados nacionais, desmarque a opção em "Empresa e metas". Jornadas que atravessam a meia-noite não são suportadas.

## Desenvolvimento

Requer [Node.js](https://nodejs.org/) 22 ou superior.

```bash
npm install
```

```bash
npm start
```

| Comando | O que faz |
| --- | --- |
| `npm start` | Abre o aplicativo desktop em modo de desenvolvimento |
| `npm run web` | Serve a mesma interface no navegador, em <http://localhost:5173> (dados no `localStorage`) |
| `npm test` | Executa os testes das regras de cálculo e do modelo de dados |
| `npm run dist` | Gera o instalador em `dist/` |
| `npm run icon` | Regenera `build/icon.png` |

Estrutura:

- [js/calc.js](js/calc.js): regras de cálculo, sem DOM.
- [js/model.js](js/model.js): modelo de dados (empresas, metas, migração de formatos antigos).
- [js/app.js](js/app.js): interface.
- [electron/cofre.js](electron/cofre.js): criptografia do arquivo de dados, senha e código de recuperação.
- [electron/main.js](electron/main.js) e [electron/preload.js](electron/preload.js): janela, bloqueio e gravação do arquivo de dados.

A variável de ambiente `HORAS_DATA_DIR` aponta o aplicativo para outra pasta de dados, o que é útil em testes.

## Publicando uma nova versão

1. Atualize a versão em `package.json` e a constante `VERSION` em `js/calc.js` (um teste garante que são iguais).
2. Adicione a seção `## [X.Y.Z] - AAAA-MM-DD` no [CHANGELOG.md](CHANGELOG.md).
3. Faça o commit, crie a tag e envie:

```bash
git tag vX.Y.Z
```

```bash
git push origin main --tags
```

O workflow [release.yml](.github/workflows/release.yml) executa os testes, confere a versão, gera o instalador e publica a release com as notas do changelog. Os arquivos `latest.yml` e `.blockmap` anexados à release são o que os aplicativos instalados consultam para se atualizar, então não os remova.

## Licença

[MIT](LICENSE)
