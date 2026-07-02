/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectContextPanel } from './ProjectContextPanel';
import {
  InMemoryProjectContextBackend,
  resetProjectContextBackend,
  setProjectContextBackendForTests,
} from '../../lib/project-context/store';
import type { Project } from '../../lib/projects/types';

const project: Project = {
  id: 'project-1',
  ownerUserId: 'u1',
  name: 'Project Brain',
  description: 'Context test project',
  kind: 'project',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  role: 'member',
};

describe('ProjectContextPanel', () => {
  beforeEach(() => {
    setProjectContextBackendForTests(new InMemoryProjectContextBackend());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetProjectContextBackend();
  });

  it('renders the project context tab and saves brief and instructions', async () => {
    render(<ProjectContextPanel project={project} userId="u1" />);
    expect(await screen.findByText('Project Context')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Purpose, audience/i), { target: { value: 'Brief text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Rules Larund should follow/i), { target: { value: 'Instruction text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    await waitFor(() => expect(screen.getAllByText('Saved.').length).toBeGreaterThan(0));
  });

  it('adds a pasted source and opens preview', async () => {
    render(<ProjectContextPanel project={project} userId="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add source/i }));
    fireEvent.change(screen.getByPlaceholderText('Source title'), { target: { value: 'Brand Voice.md' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste text-based/i), { target: { value: 'Brand voice is warm and concise.' } });
    const addButtons = screen.getAllByRole('button', { name: 'Add source' });
    fireEvent.click(addButtons[addButtons.length - 1]);

    expect(await screen.findByText('Brand Voice.md')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Preview'));
    expect(await screen.findByText('Text preview')).toBeInTheDocument();
    expect(screen.getAllByText(/Brand voice is warm/).length).toBeGreaterThan(0);
  });

  it('shows unsupported upload errors', async () => {
    render(<ProjectContextPanel project={project} userId="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add source/i }));
    fireEvent.click(screen.getByRole('button', { name: /Upload files/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'deck.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/PDF\/DOCX extraction will come later/)).toBeInTheDocument();
  });
});
