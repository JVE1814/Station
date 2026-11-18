"""Resolve a contiguous rail alignment between OSM service stop positions."""

from collections import defaultdict
from heapq import heappop, heappush
from itertools import pairwise
from math import asin, cos, radians, sin, sqrt


def ground_distance(start: list, end: list) -> float:
    lon1, lat1 = map(radians, start)
    lon2, lat2 = map(radians, end)
    haversine = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 12_742_017.6 * asin(sqrt(min(1, haversine)))


def segment_graph(inventory: dict, relation_id: int) -> tuple:
    relation = inventory["relations"][str(relation_id)]
    graph = defaultdict(list)
    positions = {}
    for kind, way_id, role in relation["members"]:
        if kind != "w" or role.startswith(("platform", "stop")):
            continue
        way = inventory["ways"][str(way_id)]
        if way["tags"].get("railway") != "rail":
            continue
        for node, position in zip(way["nodeIds"], way["points"], strict=True):
            positions[node] = position
        for start, end in pairwise(way["nodeIds"]):
            distance = ground_distance(positions[start], positions[end])
            if distance > 0:
                graph[start].append((end, distance, way_id))
                graph[end].append((start, distance, way_id))
    return graph, positions


def alignment(inventory: dict, relation_id: int, start: int, finish: int) -> list:
    graph, positions = segment_graph(inventory, relation_id)
    if start not in graph or finish not in graph:
        raise ValueError(f"Stop nodes {start} and {finish} must be on railway relation {relation_id}")

    shortest = {start: 0.0}
    predecessor = {}
    queue = [(0.0, start)]
    while queue:
        distance, current = heappop(queue)
        if current == finish:
            break
        if distance != shortest[current]:
            continue
        for adjacent, length, way in graph[current]:
            candidate = distance + length
            if candidate < shortest.get(adjacent, float("inf")):
                shortest[adjacent] = candidate
                predecessor[adjacent] = (current, way)
                heappush(queue, (candidate, adjacent))
    else:
        raise ValueError(f"No connected route from {start} to {finish} in relation {relation_id}")

    current = finish
    path = []
    while current != start:
        previous, way = predecessor[current]
        path.append({"node": current, "way": way, "point": positions[current], "distance": shortest[current]})
        current = previous
    path.reverse()
    return [{"node": start, "way": None, "point": positions[start], "distance": 0}, *path]
