# C 接入点

攻击命中后经 RaidController.applyDamage 更新生命并通知 DamageTaken；在这里增加武器、命中检测与冷却。参考docs/handoff.md，避免同时由事件订阅者再次扣血。
