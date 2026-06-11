# Auditoria LOW_VOLATILITY

## Escopo

Auditoria focada nos filtros de baixa volatilidade do motor estratégico:

- `isLowVolatility`
- `isVeryLowVolatility`
- `shouldBlock`

Não foram alterados cache, banco de dados, frontend ou API. A coleta histórica é feita por script read-only sobre `public.signal_history`.

## Diagnóstico do comportamento anterior

- `isLowVolatility` identifica volatilidade M5 entre `0` e `0.12`.
- `isVeryLowVolatility` usa cortes por modo (`0.05` conservador, `0.025` equilibrado, `0.02` agressivo).
- Antes do ajuste, qualquer `isVeryLowVolatility` entrava em `blocks`, então `shouldBlock` ficava verdadeiro independentemente do score estratégico.
- O modo conservador também mantinha bloqueio para baixa volatilidade moderada por meio dos bloqueios moderados do modo.

## Nova regra implementada

| Modo | Regra para LOW_VOLATILITY |
| --- | --- |
| CONSERVADOR | Mantém bloqueio atual. |
| EQUILIBRADO | Libera baixa volatilidade severa somente quando o score candidato for maior que `90`; mantém penalidade de baixa volatilidade. |
| AGRESSIVO | Libera baixa volatilidade severa somente quando o score candidato for maior que `80`; mantém penalidade de baixa volatilidade. |

## Métricas solicitadas

O script `scripts/audit-low-volatility-filters.js` gera um JSON com:

- percentual global de sinais bloqueados por baixa volatilidade;
- participação dos bloqueios LOW_VOLATILITY no total de bloqueios;
- winrate histórico em cenários de baixa volatilidade com sinais resolvidos (`win`/`loss`);
- impacto por modo, incluindo bloqueios liberáveis pelos novos cortes.

### Fórmulas

- `lowVolatilityBlockRate = lowVolatilityBlocks / totalSignals * 100`
- `shareOfAllBlocks = lowVolatilityBlocks / totalBlocks * 100`
- `historicalWinrate = wins / resolvedLowVolatilitySignals * 100`
- `releasableLowVolatilityBlockRate = releasableBlocks / lowVolatilityBlocks * 100`

### Execução

```bash
node scripts/audit-low-volatility-filters.js
```

> Observação: a execução é read-only e não cria/atualiza tabelas.

## Resultado esperado do rebalanceamento

- CONSERVADOR: sem aumento de risco, pois mantém o bloqueio atual.
- EQUILIBRADO: reduz bloqueios excessivos apenas quando há score institucional extremamente alto (`> 90`).
- AGRESSIVO: aumenta oportunidade operacional em baixa volatilidade severa com score forte (`> 80`).
- Todos os modos preservam `shouldBlock` para outros bloqueios críticos, como candles insuficientes, tendência muito fraca e inconsistência grave entre timeframes.
