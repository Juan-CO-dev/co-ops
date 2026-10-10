import { currentFloorStation, isFloorStation, taskVisible, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";
import { defaultOpenMap, type SectionProgress } from "@/lib/collapsible-sections";

export function assignmentSectionDefaults(board: ShiftBoard, compact: boolean): Record<string, boolean> {
  const ownTaskCount = board.tasks.filter((task) => task.assigneeId === board.viewerId && task.available !== false).length;
  const hasStation = !!currentFloorStation(board, board.viewerId)?.stationId;
  if (compact) return { tasks: !ownTaskCount && !hasStation, stations: !ownTaskCount && !hasStation, team: false };
  const positions = board.stations.filter((station) => isFloorStation(station) && !station.closedAt).flatMap((station) => station.positions.filter((position) => position.active));
  const assignedStations = positions.filter((position) => board.people.some((person) => currentFloorStation(board, person.id)?.positionId === position.id)).length;
  const progress: SectionProgress[] = [
    { id: "stations", done: assignedStations, total: positions.length },
    { id: "tasks", done: new Set(board.tasks.filter((task) => task.available !== false).map((task) => task.task)).size, total: 8 },
    { id: "people", done: board.people.filter((person) => person.hasWork).length, total: board.people.length },
    { id: "unassigned", done: 0, total: 0 },
  ];
  return defaultOpenMap(progress);
}

export function dashboardWorkVisibility(board: ShiftBoard, task: TaskType): { taskTile: boolean; stationCard: boolean } {
  const own = board.tasks.filter((assignment) => assignment.assigneeId === board.viewerId);
  return {
    taskTile: taskVisible(board.viewerLevel, task, own),
    // Station records carry no task links; the station gets its own navigation card.
    stationCard: !!currentFloorStation(board, board.viewerId)?.stationId,
  };
}

export function closingStationAnchor(stationKey: string): string {
  return `closing-station-${encodeURIComponent(stationKey)}`;
}
