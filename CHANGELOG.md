# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
