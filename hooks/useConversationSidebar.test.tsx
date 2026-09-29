import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useConversationSidebar } from './useConversationSidebar';

const sidebar = vi.hoisted(() => ({ collapsed: false, set: vi.fn() }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ sidebarCollapsed: sidebar.collapsed, setSidebarCollapsed: sidebar.set }) }));

function Harness({ selection, update = 0 }: { selection: string | null; update?: number }) {
  useConversationSidebar(selection);
  return <span>{update}</span>;
}

afterEach(() => { sidebar.collapsed = false; sidebar.set.mockReset(); });

it('collapses only on explicit chat selection, preserves manual expansion, and restores entry preference', () => {
  const view = render(<Harness selection={null} />);
  view.rerender(<Harness selection="conversation-a" />);
  expect(sidebar.set).toHaveBeenCalledTimes(1);
  expect(sidebar.set).toHaveBeenLastCalledWith(true);
  sidebar.collapsed = true;
  view.rerender(<Harness selection="conversation-a" update={1} />);
  expect(sidebar.set).toHaveBeenCalledTimes(1);
  sidebar.collapsed = false;
  view.rerender(<Harness selection="conversation-a" update={2} />);
  expect(sidebar.set).toHaveBeenCalledTimes(1);
  view.rerender(<Harness selection={null} />);
  expect(sidebar.set).toHaveBeenCalledTimes(1);
});

it('collapses a newly selected chat and restores a previously expanded sidebar on exit', () => {
  const view = render(<Harness selection="conversation-a" />);
  sidebar.collapsed = true;
  view.rerender(<Harness selection="conversation-a" update={1} />);
  view.rerender(<Harness selection="conversation-b" />);
  expect(sidebar.set).toHaveBeenCalledTimes(1);
  view.rerender(<Harness selection={null} />);
  expect(sidebar.set).toHaveBeenLastCalledWith(false);
});

it('collapses a different chat after the navigation was manually reopened', () => {
  const view = render(<Harness selection="conversation-a" />);
  sidebar.collapsed = true;
  view.rerender(<Harness selection="conversation-a" update={1} />);
  sidebar.collapsed = false;
  view.rerender(<Harness selection="conversation-a" update={2} />);
  view.rerender(<Harness selection="conversation-b" />);
  expect(sidebar.set).toHaveBeenCalledTimes(2);
  expect(sidebar.set).toHaveBeenLastCalledWith(true);
});

it.each(['close selection', 'unmount'] as const)(
  'keeps the last manual collapse after switching chats and %s',
  exit => {
    const view = render(<Harness selection="conversation-a" />);
    expect(sidebar.set).toHaveBeenCalledTimes(1);
    sidebar.collapsed = true;
    view.rerender(<Harness selection="conversation-a" update={1} />);
    sidebar.collapsed = false;
    view.rerender(<Harness selection="conversation-a" update={2} />);
    sidebar.collapsed = true;
    view.rerender(<Harness selection="conversation-a" update={3} />);
    view.rerender(<Harness selection="conversation-b" />);
    if (exit === 'unmount') view.unmount();
    else view.rerender(<Harness selection={null} />);
    expect(sidebar.set).toHaveBeenCalledTimes(1);
  },
);
