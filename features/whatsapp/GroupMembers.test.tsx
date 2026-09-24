import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupMembersModal } from './GroupMembers';
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
describe('group member list', () => {
  it('filters and opens a member without sending messages; LID-only member cannot be opened', () => {
    const open = vi.fn();
    render(<GroupMembersModal name="Grupo" members={[{ id: 'a', name: 'Maria', phone: '+5511999990000', admin: true }, { id: 'b', name: 'João', phone: null, admin: false }]} loading={false} error={null} onClose={() => {}} onRetry={() => {}} onOpenChat={open} />);
    expect(screen.getAllByRole('button', { name: 'Abrir conversa' })[1]).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar participante' }), { target: { value: 'Maria' } });
    expect(screen.queryByText('João')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir conversa' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ name: 'Maria', phone: '+5511999990000' }));
  });
});
