# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [2.0.0] - 2026-11-12

### Adicionado

- Aplicativo desktop para Windows com instalador, atalhos no menu Iniciar e na área de trabalho.
- Várias empresas, cada uma com meta mensal, jornada diária, almoço padrão e registros próprios.
- Cadastro inicial da empresa e das horas a cumprir por mês na primeira abertura.
- Meta específica para um mês (mês de entrada ou saída da empresa, por exemplo).
- Gravação dos registros em arquivo local do usuário, com escrita atômica e cópia de segurança da versão anterior.
- Licença MIT.

### Alterado

- O backup em JSON passa a incluir todas as empresas. Backups da versão 1 continuam sendo aceitos na importação.
- A release publica o instalador do Windows no lugar do pacote `.zip`.
- `npm start` abre o aplicativo desktop; a versão para navegador passa a ser `npm run web`.

## [1.0.0] - 2026-11-12

### Adicionado

- Registro diário de entrada, saída para o almoço, retorno e saída, com navegação por mês.
- Meta mensal (padrão 152:00), jornada diária (padrão 08:00) e almoço padrão configuráveis.
- Resumo do mês: horas trabalhadas, quanto falta para a meta, saldo (banco) e projeção de fechamento.
- Painel "Hoje" com o horário de saída para cumprir a jornada e o horário ajustado pelo saldo acumulado (sair mais cedo ou mais tarde).
- Média de horas necessária por dia útil restante para fechar a meta.
- Validação dos horários (ordem e preenchimento) com mensagem por dia.
- Tipos de dia: trabalho, feriado/folga e abono/atestado.
- Exportação e importação de backup em JSON e exportação do mês em CSV.
- Testes automatizados das regras de cálculo e workflows de CI e de release no GitHub Actions.
