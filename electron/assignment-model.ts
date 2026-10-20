export const ASSIGNMENT_STATUSES = ['Очікує рішення', 'Призначено', 'В роботі', 'Передано до казначейства', 'Виплачено'] as const
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number]
export const assignmentStatusOrder: Record<AssignmentStatus, number> = {
  'Очікує рішення': 0, 'Призначено': 1, 'В роботі': 2, 'Передано до казначейства': 3, 'Виплачено': 4,
}
export const assignmentStatusColor: Record<AssignmentStatus, string> = {
  'Очікує рішення': 'awaiting', 'Призначено': 'assigned', 'В роботі': 'progress', 'Передано до казначейства': 'treasury', 'Виплачено': 'paid',
}
export const isAssignedStatus = (status: AssignmentStatus) => status !== 'Очікує рішення'
export const isStatementEligible = (status: AssignmentStatus) => status === 'Призначено' || status === 'В роботі' || status === 'Передано до казначейства'
