# Graph Loading Specification

## Purpose
Graph loading turns the Graphify map that YodaMan serves into the node, edge and cluster data the layout engine and the 3D scene use. It lives in `backend/graphProcessor.js` (`normalizeNodes`, `normalizeEdges`, `extractClusters`, `computeGraphHash`) and `backend/ignoredPaths.js` (`IGNORED_DIRECTORIES`, `isIgnoredPath`). It never fetches or rewrites the graph itself and never invents data the API did not give.

## Requirements

### Requirement: Node normalisation
`normalizeNodes` SHALL map each API node to `{ id, path, type, language, size, importance, changeFrequency, recentlyChanged, clusterId, position }` and SHALL return `[]` for any input that is not an array. A null or non-object entry SHALL become a placeholder node with id `generated-id-<index>`, type `file` and cluster `root`.

#### Scenario: Missing or empty id
- **WHEN** a node has no id or an empty id string
- **THEN** its id becomes `generated-id-<index>`

#### Scenario: Path fallbacks
- **WHEN** a node has no `path`
- **THEN** the path is taken from `sourceFile` or `source_file`, and otherwise from the id

#### Scenario: Not an array
- **WHEN** `normalizeNodes` receives null, undefined or an object
- **THEN** it returns an empty array

### Requirement: Node field defaults
The type SHALL be one of `file`, `class`, `function` or `folder` (read from `type`, `fileType`, `file_type` or `metadata.kind`), else `file`. `size` SHALL be floored and clamped to 0 or more, `importance` clamped to 0 or more, and both SHALL default to 0 when missing or NaN. `position` SHALL start at the origin.

#### Scenario: Unknown node type
- **WHEN** a node has type `module`
- **THEN** its type becomes `file`

#### Scenario: Bad size
- **WHEN** a node has size -5, NaN or no size
- **THEN** its size is 0

### Requirement: Language inference
The language SHALL be the lower-cased `language` or `metadata.language` when present. Otherwise it SHALL come from the path extension through a fixed table (for example `jsx`, `mjs` and `cjs` give `js`, `yml` gives `yaml`, `kt` gives `kotlin`), and SHALL be an empty string when the extension is unknown.

#### Scenario: Language from extension
- **WHEN** a node has no language and the path `lib/main.dart`
- **THEN** its language is `dart`

#### Scenario: Unknown extension
- **WHEN** a node has no language and the path `bin/tool.xyz`
- **THEN** its language is an empty string

### Requirement: Change frequency is never invented
`changeFrequency` SHALL be the API's numeric value clamped to 0 or more, and SHALL be `null` (unknown) when the API gives none or gives NaN. `recentlyChanged` SHALL be true only when the change frequency is known and greater than 3. No value SHALL be derived from the file path.

#### Scenario: No value from the API
- **WHEN** a node has no `changeFrequency`
- **THEN** its `changeFrequency` is null and `recentlyChanged` is false

#### Scenario: Real count
- **WHEN** a node has `changeFrequency` 5
- **THEN** `recentlyChanged` is true

### Requirement: Folder clusters
`pathToClusterId` SHALL derive a node's cluster from its directory segments, capped at three (`MAX_CLUSTER_DEPTH`), after turning backslashes into slashes. A root-level file, an empty path or a missing path SHALL give `root`. `clusterDepth` SHALL return 0 for root and at most 3; `clusterLabel` SHALL return the last segment.

#### Scenario: Deep path is capped
- **WHEN** the path is `src/auth/sub/deep/AuthService.dart`
- **THEN** the cluster id is `src/auth/sub` with depth 3 and label `sub`

#### Scenario: Root-level file
- **WHEN** the path is `README.md`
- **THEN** the cluster id is `root` with depth 0

### Requirement: Cluster extraction
`extractClusters` SHALL group nodes by `clusterId` and return one cluster per group with `id`, `label`, `depth`, a centroid at the origin, `radius` of `3 + sqrt(nodeCount) * 0.4` and `nodeIds`. Clusters SHALL be sorted by node count, largest first.

#### Scenario: Densest cluster first
- **WHEN** `src/auth` holds five nodes and `src/utils` holds two
- **THEN** `src/auth` is the first cluster returned

### Requirement: Edge normalisation
`normalizeEdges` SHALL drop edges whose trimmed source or target is empty and self-loops. The type SHALL be lower-cased and mapped to `import`, `call`, `inheritance` or `composition`, defaulting to `import`. The weight SHALL be floored with a minimum of 1, defaulting to 1. The id SHALL be `<source>→<target>`.

#### Scenario: Unknown type and bad weight
- **WHEN** an edge has type `Uses` and weight 0.4
- **THEN** its type is `import` and its weight is 1

#### Scenario: Duplicate edges
- **WHEN** two edges share source, target and type
- **THEN** only the first is kept

### Requirement: Graph hash
`computeGraphHash` SHALL return the 64-character hex SHA-256 of a canonical JSON payload: nodes reduced to `id`, `path`, `type`, `size` and `importance` sorted by id, edges reduced to `source`, `target`, `type` and `weight` sorted by source, target and type, plus `version: 1`. Non-array arguments SHALL be treated as empty.

#### Scenario: Order does not matter
- **WHEN** the same nodes and edges are hashed in a different order
- **THEN** the hash is the same

#### Scenario: Data changes
- **WHEN** a node is added
- **THEN** the hash changes

### Requirement: Ignored directories
`isIgnoredPath` SHALL return true when any segment of a path, split on `/` or `\`, equals an entry of `IGNORED_DIRECTORIES` (such as `node_modules`, `vendor`, `third_party`, `dist`, `build` and `graphify-out`). It SHALL match whole segments only and SHALL return false for an empty or non-string path. The graph itself SHALL keep these nodes.

#### Scenario: Whole segments only
- **WHEN** the path is `src/buildTools/compile.js`
- **THEN** `isIgnoredPath` returns false

#### Scenario: Vendored code
- **WHEN** the path is `tv/third_party/player/Test.java`
- **THEN** `isIgnoredPath` returns true

#### Scenario: Normalisation keeps vendored nodes
- **WHEN** `normalizeNodes` receives a node under `node_modules`
- **THEN** the node is returned, for the viewer to hide or show

### Requirement: Ignore list matches core
`IGNORED_DIRECTORIES` MUST hold the same entries as `core/shared/ignoredPaths.js`. `tests/unit/ignoredPaths.test.js` SHALL compare the two sorted lists when a core checkout sits beside this repository, and SHALL skip the comparison when it does not.

#### Scenario: Lists drift
- **WHEN** an entry is added to core's list but not to Holocron's
- **THEN** the unit test fails

#### Scenario: Standalone checkout
- **WHEN** `../core/shared/ignoredPaths.js` does not exist
- **THEN** the comparison passes without checking
