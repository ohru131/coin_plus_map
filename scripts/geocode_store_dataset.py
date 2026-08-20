#!/usr/bin/env python3
"""Create reusable coordinates for every store with a local Japanese address dictionary.

The script intentionally performs no external request per address. It uses the
jageocoder street-block dictionary that is installed once in the build runner.
"""

import argparse
import json
from pathlib import Path
from typing import Any


KANSAl_BOUNDS = {
    'min_latitude': 34.45,
    'max_latitude': 35.35,
    'min_longitude': 135.20,
    'max_longitude': 136.05,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Geocode all COIN+ store addresses with jageocoder.')
    parser.add_argument('--stores', type=Path, required=True, help='Source store dataset JSON.')
    parser.add_argument('--output', type=Path, required=True, help='Output coordinate cache JSON.')
    parser.add_argument('--db-dir', type=Path, required=True, help='Installed jageocoder dictionary directory.')
    return parser.parse_args()


def is_in_target_region(latitude: float, longitude: float) -> bool:
    return (
        KANSAl_BOUNDS['min_latitude'] <= latitude <= KANSAl_BOUNDS['max_latitude']
        and KANSAl_BOUNDS['min_longitude'] <= longitude <= KANSAl_BOUNDS['max_longitude']
    )


def choose_coordinate(search_result: dict[str, Any]) -> dict[str, float | int] | None:
    candidates = search_result.get('candidates') or []
    valid_candidates: list[dict[str, float | int]] = []
    for candidate in candidates:
        try:
            longitude = float(candidate['x'])
            latitude = float(candidate['y'])
            level = int(candidate.get('level') or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if level < 5 or not is_in_target_region(latitude, longitude):
            continue
        valid_candidates.append({
            'latitude': round(latitude, 7),
            'longitude': round(longitude, 7),
            'geocodeLevel': level,
        })
    return max(valid_candidates, key=lambda candidate: int(candidate['geocodeLevel']), default=None)


def main() -> None:
    args = parse_args()
    if not args.stores.exists():
        raise FileNotFoundError(f'Missing store dataset: {args.stores}')
    if not args.db_dir.exists():
        raise FileNotFoundError(f'Missing jageocoder dictionary: {args.db_dir}')

    import jageocoder

    jageocoder.init(db_dir=str(args.db_dir))
    dataset = json.loads(args.stores.read_text(encoding='utf-8'))
    addresses = sorted({store['address'] for store in dataset.get('stores', []) if store.get('address')})
    coordinates: dict[str, dict[str, float | int]] = {}
    unmatched: list[str] = []

    for index, address in enumerate(addresses, start=1):
        coordinate = choose_coordinate(jageocoder.search(address))
        if coordinate:
            coordinates[address] = coordinate
        else:
            unmatched.append(address)
        if index % 500 == 0 or index == len(addresses):
            print(f'Geocoded {index}/{len(addresses)} addresses ({len(coordinates)} resolved).')

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                'generator': 'jageocoder street-block dictionary',
                'totalAddresses': len(addresses),
                'resolvedAddresses': len(coordinates),
                'coordinates': coordinates,
                'unmatchedAddresses': unmatched,
            },
            ensure_ascii=False,
            separators=(',', ':'),
        ),
        encoding='utf-8',
    )
    print(f'Resolved {len(coordinates)}/{len(addresses)} addresses.')
    if unmatched:
        print(f'Unmatched addresses: {len(unmatched)}')


if __name__ == '__main__':
    main()
