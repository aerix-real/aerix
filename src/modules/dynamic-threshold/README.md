# Dynamic Threshold Learning

Módulo responsável por recalibrar continuamente os limiares institucionais da AERIX com base em performance real.

Ajusta automaticamente:
- `minimumScore`
- `confidence`
- `sniperTiming`
- `adaptiveAdjustment`

Sinais considerados:
- winrate por ativo
- winrate por horário
- winrate por estratégia
- winrate por regime de mercado

Saídas principais:
- `thresholdHistory`
- `thresholdChanges`
- `thresholdPerformance`
