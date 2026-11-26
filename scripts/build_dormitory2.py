"""Two-storey red-brick apartment, kept west of the plaza access road.

Facade details are a low-poly interpretation, not a surveyed reconstruction.
The footprint comes from the same layout used by collision and the minimap.
"""


def build_dormitory2(ctx, building):
    box, material, U = ctx['box'], ctx['material'], ctx['U']
    block = building['blocks'][0]
    x, y = (block['x'] + block['width']/2)/U, (block['y'] + block['height']/2)/U
    w, d, h = block['width']/U, block['height']/U, block['elevation']
    prefix = 'District_Dormitory2_'
    brick = material('dormitory2_brick', (.48, .18, .12))
    stone = ctx['trim']
    glass = ctx['glass']
    frame = ctx['frame']
    roof = ctx['roof']

    def b(name, xx, yy, zz, ww, dd, hh, mat):
        return box(prefix+name, xx, yy, zz, ww, dd, hh, mat)

    b('mass', x, y, h/2, w, d, h, brick)
    b('base', x, y, .14, w+.08, d+.08, .28, ctx['base'])
    b('flat_roof', x, y, h+.04, w+.18, d+.18, .12, roof)
    for z in [.32, h/2, h-.07]:
        b('floor_band', x, y, z, w+.12, d+.12, .075, stone)
    for side in [-1, 1]:
        b('parapet_long', x, y+side*d/2, h+.17, w+.16, .10, .22, stone)
        b('parapet_end', x+side*w/2, y, h+.17, .10, d, .22, stone)
    # Keep a clear central entrance bay instead of hiding the door under windows.
    bays = 15
    for side in [-1, 1]:
        yy = y+side*(d/2+.025)
        for floor in range(2):
            z = .86+floor*1.43
            for col in range(bays):
                if side == 1 and floor == 0 and col == bays//2:
                    continue
                xx = x-w/2+w*(col+.5)/bays
                b('window_frame', xx, yy, z, .47, .055, .78, stone)
                b('window_glass', xx, yy+side*.032, z, .39, .025, .66, glass)
                b('window_mullion', xx, yy+side*.049, z, .022, .02, .66, frame)
                b('window_sill', xx, yy+side*.045, z-.40, .51, .12, .04, stone)
        for col in range(bays+1):
            b('pilaster', x-w/2+w*col/bays, yy, h/2, .045, .07, h, stone)
    for side in [-1, 1]:
        for floor in range(2):
            for offset in [-d*.25, d*.25]:
                b('end_window', x+side*(w/2+.025), y+offset, .86+floor*1.43,
                  .04, .46, .70, glass)
    front = y+d/2
    b('entrance_frame', x, front+.05, .69, .78, .10, 1.30, stone)
    b('entrance_glass', x, front+.11, .69, .65, .035, 1.18, glass)
    b('entrance_mullion', x, front+.14, .69, .028, .025, 1.18, frame)
    b('entrance_canopy', x, front+.25, 1.49, 1.12, .62, .10, stone)
    # Flush, walkable apron; no extra collision box or raised step across the path.
    b('entrance_apron', x, front+.24, .04, 1.4, .48, .035, stone)
