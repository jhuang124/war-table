// Unit tests only look at this checkout: agents' worktrees under .claude/ carry their own copies.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
