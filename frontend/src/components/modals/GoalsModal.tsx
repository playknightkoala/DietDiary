import { api } from '../../lib/api';
import { useStore } from '../../store';
import { GoalManager } from '../GoalManager';
import { CloseButton, ModalShell } from './ModalShell';

export function GoalsModal() {
  const goals = useStore((s) => s.goals);
  const loadGoals = useStore((s) => s.loadGoals);
  const closeModal = useStore((s) => s.closeModal);

  return (
    <ModalShell maxWidth={440} cardStyle={{ padding: 22, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>階段目標</div>
        <CloseButton onClick={closeModal} />
      </div>
      <GoalManager
        goals={goals}
        memberView
        onCreate={async (input) => { await api.createGoal(input); await loadGoals(); }}
        onUpdate={async (id, input) => { await api.updateGoal(id, input); await loadGoals(); }}
        onDelete={async (id) => { await api.deleteGoal(id); await loadGoals(); }}
      />
    </ModalShell>
  );
}
