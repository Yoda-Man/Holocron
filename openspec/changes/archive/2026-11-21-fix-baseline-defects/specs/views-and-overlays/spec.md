## MODIFIED Requirements

### Requirement: Filters
`setFilter(type, enabled)` SHALL accept only the keys `tests`, `thirdParty`, `generated`, `recent`, `dart`, `json`, `yaml`, `markdown`, `typescript`, `javascript` and `python`, warn `[VR] Unknown filter type: <type>` for any other key, and emit `filter-change`. A node SHALL be shown only when it passes every active filter. Hidden nodes and their glow SHALL be scaled to zero, and shown again when the filter turns off. `render` SHALL reset all filters to off.

#### Scenario: Unknown key
- **WHEN** `setFilter('rust', true)` is called
- **THEN** a warning is logged and nothing changes

#### Scenario: No filters
- **WHEN** every filter is off
- **THEN** every rendered node is visible

#### Scenario: Glow follows its node
- **WHEN** a filter hides a node without glow
- **THEN** the glow of every visible node is untouched

### Requirement: Language filters
A language filter SHALL show only nodes of that language. Languages SHALL be compared through the colour alias table, so `typescript` matches `ts` and `tsx`, `javascript` matches `js`, `python` matches `py` and `markdown` matches `md`. Two language filters on at once SHALL therefore show nothing.

#### Scenario: Dart only
- **WHEN** `dart` is on
- **THEN** only nodes with language `dart` stay visible

#### Scenario: Short language names
- **WHEN** `markdown` is on
- **THEN** a node with language `md` stays visible
