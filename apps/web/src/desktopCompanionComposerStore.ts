import { create } from "zustand";

interface DesktopComposerOwner {
  readonly token: string;
  readonly threadKey: string;
  readonly reclaim: () => void;
}

interface DesktopCompanionComposerState {
  readonly owner: DesktopComposerOwner | null;
  claim: (owner: DesktopComposerOwner) => void;
  release: (token: string) => void;
}

export const useDesktopCompanionComposerStore = create<DesktopCompanionComposerState>()((set) => ({
  owner: null,
  claim: (owner) => set({ owner }),
  release: (token) => set((state) => (state.owner?.token === token ? { owner: null } : state)),
}));
