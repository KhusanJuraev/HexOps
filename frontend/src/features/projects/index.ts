// Public interface of the projects feature. Reports (Stage 4) and Notes (Stage 5)
// will use these to show and pick projects; pages are loaded by the route registry.
export { projectKeys, useProject, useProjects } from './api'
export type { Project, ProjectListItem, ProjectStatus, ProjectType } from './types'
