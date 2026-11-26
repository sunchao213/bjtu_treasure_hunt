"""Compatibility entry point for local sprite preparation.

Generate new artwork with the imagegen skill and the supplied references.
The former geometric placeholder generator has been retired. This command
imports supplied sprites and/or rebuilds the overview without redrawing them.
"""

import argparse
from pathlib import Path

from prepare_item_references import import_references, overview


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    args = parser.parse_args()
    if args.source_dir:
        import_references(args.source_dir)
    overview()
