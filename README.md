# Registro de Horas

Aplicativo desktop para registrar as horas trabalhadas, acompanhar a meta mensal de cada empresa e saber, enquanto o dia é preenchido, a que horas é possível sair mais cedo ou é preciso sair mais tarde.

- Funciona offline: não há servidor, conta ou envio de dados.
- Os registros ficam somente no computador de quem usa, fora da pasta do programa.
- Várias empresas, cada uma com sua meta e jornada — útil ao trocar de trabalho ou ter mais de um.

## Instalação (Windows)

1. Baixe o arquivo `Registro-de-Horas-Setup-X.Y.Z.exe` na página de [Releases](../../releases/latest).
2. Execute o instalador e siga os passos. Não é necessário ser administrador.
3. Abra o **Registro de Horas** pelo menu Iniciar ou pelo atalho da área de trabalho.

O instalador não é assinado digitalmente, então o Windows SmartScreen pode exibir um aviso: escolha "Mais informações" e "Executar assim mesmo".

Na primeira abertura, informe o nome da empresa e as horas a cumprir por mês (padrão **152:00**, com jornada de **08:00** por dia).

## Funcionalidades

- **Empresas**: cadastre quantas quiser e alterne entre elas. Cada uma guarda sua meta mensal, jornada diária, almoço padrão e registros.
- **Meta só de um mês**: ajuste a meta de um mês específico (por exemplo, o mês de entrada ou de saída da empresa) sem mudar a meta padrão.
- **Registro diário**: entrada, saída para o almoço, retorno e saída. O almoço é opcional.
- **Resumo do mês**: trabalhado, quanto falta para a meta, saldo (banco) frente à jornada diária e projeção de fechamento.
- **Painel "Hoje"**: com a entrada preenchida, mostra a saída para cumprir a jornada e a saída ajustada pelo saldo acumulado — mais cedo se o saldo é positivo, mais tarde se é negativo. Enquanto o retorno do almoço não é informado, considera o almoço padrão.
- **Média necessária**: horas por dia útil restante para fechar a meta.
- **Validação**: aponta horários fora de ordem ou incompletos em cada dia.
- **Tipos de dia**: trabalho, feriado/folga (não conta) e abono/atestado (credita a jornada diária).
- **Backup**: exportação/importação em JSON (todas as empresas) e exportação do mês em CSV.

## Onde ficam os dados

No aplicativo instalado, em `%APPDATA%\Registro de Horas\dados.json` (o caminho exato aparece no rodapé da seção "Empresa e metas"). A cada gravação, a versão anterior é mantida em `dados.json.bak`. Desinstalar o programa não apaga esses arquivos.

Este repositório contém apenas código: nenhum registro de horas faz parte dele, e o `.gitignore` bloqueia arquivos de dados e de backup.

## Regras de cálculo

| Item | Regra |
| --- | --- |
| Total do dia | `(saída − entrada) − (retorno − saída almoço)` |
| Saldo do dia | total − jornada diária (em fins de semana e feriados, tudo conta como extra) |
| Faltam | meta do mês − trabalhado |
| Dias úteis restantes | dias de segunda a sexta, de hoje em diante, ainda não concluídos e não marcados como folga/abono |
| Projeção | trabalhado + dias úteis restantes × jornada diária |

Feriados não são detectados automaticamente: marque o dia como **Feriado/Folga**. Jornadas que atravessam a meia-noite não são suportadas.

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
- [electron/main.js](electron/main.js) e [electron/preload.js](electron/preload.js): janela e gravação do arquivo de dados.

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

O workflow [release.yml](.github/workflows/release.yml) executa os testes, confere a versão, gera o instalador e publica a release com as notas do changelog.

## Licença

[MIT](LICENSE)
