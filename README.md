# Registro de Horas

Ferramenta web simples para registrar as horas trabalhadas no mês, acompanhar a meta mensal (padrão **152:00**, com jornada de **08:00** por dia) e saber, enquanto o dia é preenchido, a que horas é possível sair mais cedo ou é preciso sair mais tarde.

Não há backend nem dependências: é HTML, CSS e JavaScript puro. Os registros ficam no `localStorage` do navegador.

## Como usar

Requer [Node.js](https://nodejs.org/) 20 ou superior apenas para o servidor local e os testes.

```bash
npm start
```

Abra <http://localhost:5173>. Use sempre o mesmo endereço: os dados são guardados por origem (endereço + porta) no navegador.

## Funcionalidades

- **Registro diário**: entrada, saída para o almoço, retorno e saída. O almoço é opcional.
- **Resumo do mês**: trabalhado, quanto falta para a meta, saldo (banco) frente à jornada diária e projeção de fechamento.
- **Painel "Hoje"**: com a entrada preenchida, mostra a saída para cumprir a jornada e a saída ajustada pelo saldo acumulado — mais cedo se o saldo é positivo, mais tarde se é negativo. Enquanto o retorno do almoço não é informado, considera o almoço padrão.
- **Média necessária**: horas por dia útil restante para fechar a meta.
- **Validação**: aponta horários fora de ordem ou incompletos em cada dia.
- **Tipos de dia**: trabalho, feriado/folga (não conta) e abono/atestado (credita a jornada diária).
- **Backup**: exportação/importação em JSON e exportação do mês em CSV.

## Regras de cálculo

| Item | Regra |
| --- | --- |
| Total do dia | `(saída − entrada) − (retorno − saída almoço)` |
| Saldo do dia | total − jornada diária (em fins de semana e feriados, tudo conta como extra) |
| Faltam | meta mensal − trabalhado |
| Dias úteis restantes | dias de segunda a sexta, de hoje em diante, ainda não concluídos e não marcados como folga/abono |
| Projeção | trabalhado + dias úteis restantes × jornada diária |

Feriados não são detectados automaticamente: marque o dia como **Feriado/Folga**.

## Desenvolvimento

```bash
npm test
```

As regras ficam em [js/calc.js](js/calc.js) (sem DOM, cobertas por [tests/calc.test.js](tests/calc.test.js)) e a interface em [js/app.js](js/app.js).

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

O workflow [release.yml](.github/workflows/release.yml) executa os testes, confere a versão, extrai as notas do changelog e publica a release com o pacote `.zip`.
