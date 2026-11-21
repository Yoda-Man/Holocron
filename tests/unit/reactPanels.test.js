/**
 * InfoPanel and SettingsPanel, the shipped .jsx files, rendered with the
 * hook runtime in helpers/hooks.js.
 */
import { jest } from '@jest/globals';
import { mount, elements, text } from './helpers/hooks.js';
import { loadJsx } from './helpers/loadJsx.js';

const { default: InfoPanel } = await loadJsx('frontend/InfoPanel.jsx');
const { default: SettingsPanel } = await loadJsx('frontend/SettingsPanel.jsx');

beforeEach(() => {
  global.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } };
});
afterEach(() => { delete global.document; });

describe('InfoPanel', () => {
  test('renders nothing without a node', () => {
    expect(mount(InfoPanel, { node: null }).tree).toBeNull();
  });

  test('keeps the same hooks when a node is selected and cleared', () => {
    const panel = mount(InfoPanel, { node: null });
    expect(text(panel.render({ node: { id: 'src/app.js', path: 'src/app.js', size: 12 } }))).toContain('src/app.js');
    expect(panel.render({ node: null })).toBeNull();
  });
});

describe('SettingsPanel show checkboxes', () => {
  async function drawer(filters, onFilterChange) {
    const panel = mount(SettingsPanel, { open: true, filters, onFilterChange });
    await new Promise((r) => setTimeout(r, 0));
    return panel.render();
  }
  const checkbox = (tree, label) => elements(tree)
    .find((e) => e.type === 'label' && text(e) === label)
    .props.children.find((c) => c?.type === 'input');

  it.each([
    ['Show test files', 'tests'],
    ['Show third-party code', 'thirdParty'],
    ['Show generated files', 'generated'],
  ])('"%s" is checked while %s is shown, and checking it shows them', async (label, key) => {
    const onFilterChange = jest.fn();
    const shown = checkbox(await drawer({ [key]: false }, onFilterChange), label);
    expect(shown.props.checked).toBe(true);
    const hidden = checkbox(await drawer({ [key]: true }, onFilterChange), label);
    expect(hidden.props.checked).toBe(false);
    hidden.props.onChange({ target: { checked: true, type: 'checkbox' } });
    expect(onFilterChange).toHaveBeenCalledWith(key, false);
  });

  test('"Only changed in 30 days" turns its filter on', async () => {
    const onFilterChange = jest.fn();
    const box = checkbox(await drawer({}, onFilterChange), 'Only changed in 30 days');
    box.props.onChange({ target: { checked: true, type: 'checkbox' } });
    expect(onFilterChange).toHaveBeenCalledWith('recent', true);
  });
});
