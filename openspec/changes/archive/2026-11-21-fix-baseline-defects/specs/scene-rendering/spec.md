## MODIFIED Requirements

### Requirement: Instanced nodes
`render(nodes, edges, positions)` SHALL draw at most `maxNodes` nodes as one `InstancedMesh` of unlit spheres, placed from the flat `positions` array. Scale SHALL grow linearly with `size` from 0.12 at 0 lines to 0.5 at 2000 lines or more. Nodes with importance above 5 SHALL get a second translucent, additive glow sphere 1.6 times larger. Every change to a node's glow SHALL reach that node's own glow sphere.

#### Scenario: Too many nodes
- **WHEN** 5000 nodes are rendered with `maxNodes` 3000
- **THEN** only the first 3000 are drawn and edges to the rest are skipped

#### Scenario: Rebuild
- **WHEN** `render` is called again
- **THEN** the previous meshes, geometries and materials are disposed first

#### Scenario: Only some nodes glow
- **WHEN** the second of three nodes is the only one with importance above 5 and it is selected
- **THEN** its glow sphere turns cyan, and selecting the first node leaves that glow unchanged

### Requirement: Typed edges
Edges SHALL be drawn as one `LineSegments` object per edge type, coloured white for `import`, orange for `call`, purple for `inheritance` and teal for `composition`, with opacity 0.35, 0.45, 0.40 and 0.35. Every third frame a type's lines SHALL be shown only when at least one of its edges has both ends within 15 units of the camera.

#### Scenario: Camera far away
- **WHEN** no edge of a type has both ends within 15 units of the camera
- **THEN** that type's lines are hidden

### Requirement: Animation loop
`start()` SHALL run one `requestAnimationFrame` loop, ignoring repeat calls, that updates level of detail, eases tier changes, updates edge visibility every third frame, updates the controls, renders and tracks frame rate. The first frame SHALL log `[VR PERF] first_frame_ms: <ms>`. The loop SHALL work from the first frame after `render`.

#### Scenario: Started twice
- **WHEN** `start()` is called while the loop runs
- **THEN** no second loop starts

#### Scenario: First frames
- **WHEN** `start()` runs after `render` with edges
- **THEN** each of the first three frames calls `renderer.render`

## ADDED Requirements

### Requirement: Cluster lines
Edges between different clusters SHALL also be drawn as one faint line per cluster pair, shown when any cluster is more than 20 units away. Cluster ids MAY be strings such as `src/auth` or numbers.

#### Scenario: Folder cluster ids
- **WHEN** nodes in clusters `src/auth` and `src/db` are joined by an edge
- **THEN** one cluster line joins the two clusters
