import os
import json
import pytest
import pandas as pd
import numpy as np

from BathyMap.site_builder import BathymetrySiteBuilder


def test_json_loading():
    #Test that the json file loaded and the paths are relative to the json file
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()

    data_directory = os.path.normpath(os.path.join(os.getcwd(), 'tests/files/data'))
    assert(SiteModel.data_directory == data_directory)
    assert(SiteModel.max_map_points_per_line == 20)
    assert(SiteModel.file_extensions == ['.dep'])
    assert(SiteModel.copy_raw_files is True)


def test_dms_to_decimal():
    #Test that degrees, minutes and seconds are converted to signed decimal degrees
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()

    latitude = SiteModel.dms_to_decimal('043°34′43.3273224″', 'N')
    longitude = SiteModel.dms_to_decimal('079°42′16.6450752″', 'W')
    assert(abs(latitude - 43.5787020) < 1e-6)
    assert(abs(longitude + 79.7046236) < 1e-6)
    assert(SiteModel.dms_to_decimal('43.5', 'S') == -43.5)


def test_read_dep_file():
    #Test that the .dep file is parsed into metadata and a DataFrame of soundings
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()

    data_files = SiteModel.find_data_files()
    assert(len(data_files) == 2)
    metadata, soundings = SiteModel.read_dep_file(data_files[0])
    assert(type(metadata) == dict)
    assert(metadata['Date'] == '2026-10-16')
    assert(type(soundings) == pd.DataFrame)
    assert(len(soundings) == 50)
    assert('N/S' not in soundings.columns)
    assert(soundings['Latitude'].between(43, 44).all())
    assert(soundings['Longitude'].between(-80, -79).all())
    assert(soundings['Depth'].min() > 0)
    assert(soundings['Datetime'].is_monotonic_increasing)


def test_line_survey_metadata():
    #Test that the folder metadata file overrides the JSON file and that the other entries are kept
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()

    data_files = SiteModel.find_data_files()
    metadata, soundings = SiteModel.read_dep_file(data_files[0])
    line_metadata = SiteModel.line_survey_metadata(file_path=data_files[0], file_metadata=metadata)
    assert(line_metadata['platform'] == 'Test platform')
    assert(line_metadata['sensor'] == 'Test single-beam echosounder')
    assert(line_metadata['operator'] == 'Test operator')

    #Test that a JSON file with the same name as the data file overrides the folder metadata for that file only
    metadata, soundings = SiteModel.read_dep_file(data_files[1])
    line_metadata = SiteModel.line_survey_metadata(file_path=data_files[1], file_metadata=metadata)
    assert(line_metadata['platform'] == 'Test platform')
    assert(line_metadata['sensor'] == 'Second echosounder')
    assert(line_metadata['notes'] == 'Metadata for this file only')

    #Test that the instrument model in the file header is used when no platform is given
    SiteModel.survey_metadata = {}
    SiteModel.metadata_file_name = 'no_such_file.json'
    line_metadata = SiteModel.line_survey_metadata(file_path=data_files[0], file_metadata=metadata)
    assert(line_metadata['platform'] == 'APACHE-4(V1.1)')
    assert(line_metadata['sensor'] == '')


def test_thin_soundings():
    #Test that thinning keeps no more than the maximum number of points and keeps the last point
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()

    soundings = pd.DataFrame({'Depth': np.arange(105)})
    thinned = SiteModel.thin_soundings(soundings=soundings, maximum_points=20)
    assert(len(thinned) <= 21)
    assert(thinned['Depth'].iloc[-1] == 104)


def test_execute():
    #Test that the build writes the index, map points, csv and raw copy of each line
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    index = SiteModel.execute()

    assert(len(index['lines']) == 2)
    line = index['lines'][0]
    assert(line['points'] == 50)
    assert(line['map_points'] <= 21)
    assert(line['depth_min'] <= line['depth_mean'] <= line['depth_max'])
    assert(index['site']['depth_colour_range'][0] < index['site']['depth_colour_range'][1])
    for key in ['points', 'csv', 'raw']:
        assert(os.path.isfile(os.path.join(SiteModel.output_directory, line['files'][key])))
    with open(os.path.join(SiteModel.output_directory, 'data', 'index.json'), "r") as f:
        assert(json.load(f)['lines'][0]['id'] == line['id'])
    assert(os.path.isfile(os.path.join(SiteModel.output_directory, 'index.html')))
    assert(line['metadata']['platform'] == 'Test platform')

    #Test that the csv carries the platform and sensor of every sounding
    line_csv = pd.read_csv(os.path.join(SiteModel.output_directory, line['files']['csv']))
    assert(list(line_csv.columns[:7]) == ['id', 'Datetime', 'Latitude', 'Longitude', 'Depth', 'Platform', 'Sensor'])
    assert((line_csv['Sensor'] == 'Test single-beam echosounder').all())

    #Test that every map point carries a time so the website can show its date and time
    with open(os.path.join(SiteModel.output_directory, line['files']['points']), "r") as f:
        points = json.load(f)
    assert(points['start'].startswith('2026-10-16T00:24:42'))
    assert(len(points['t']) == len(points['lat']) == len(points['depth']))
    assert(points['t'][0] == 0)
    assert(min(np.diff(points['t'])) >= 0)

    #Test that a second build replaces the first one without complaining
    SiteModel.execute()


def test_raw_file_link_to_repository():
    #Test that the raw download links point to the data folder of the repository when the raw files are not copied
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    SiteModel.copy_raw_files = False
    SiteModel.repository_url = 'https://github.com/example-group/bathymap'

    data_files = SiteModel.find_data_files()
    raw_link = SiteModel.raw_file_link(data_files[0])
    assert(raw_link == 'https://raw.githubusercontent.com/example-group/bathymap/main/data/L0001_sample.dep')

    SiteModel.repository_url = ''
    assert(SiteModel.raw_file_link(data_files[0]) is None)


def test_map_variables():
    """
    Checks that the map points hold the extra map variables, that "Height - Depth" is computed from the two columns,
    and that the index lists the variables with depth first and OpenStreetMap as the default basemap.
    """
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    index = SiteModel.execute()
    columns = [map_variable['column'] for map_variable in index['site']['map_variables']]
    assert(columns[0] == 'Depth')
    assert('Height - Depth' in columns)
    assert(index['site']['default_basemap'] == 'openstreetmap')
    with open(os.path.join(SiteModel.output_directory, index['lines'][0]['files']['points'])) as f:
        points = json.load(f)
    assert(len(points['values']['Height']) == len(points['depth']))
    difference = points['values']['Height'][0] - points['depth'][0]
    assert(abs(points['values']['Height - Depth'][0] - difference) < 0.001)
    assert('Time of day' not in points['values'])
    soundings = SiteModel.clean_soundings(soundings=SiteModel.read_dep_file(os.path.join('tests', 'files', 'data', 'L0001_sample.dep'))[1], file_path='L0001_sample.dep')
    roll_in_degrees = SiteModel.map_variable_values(soundings=soundings, column='Roll', scale=57.29578)
    assert(abs(roll_in_degrees.iloc[0] - soundings['Roll'].iloc[0] * 57.29578) < 1e-9)
    distance = SiteModel.map_variable_values(soundings=soundings, column='Trail Distance', from_line_start=True)
    assert(distance.iloc[0] == 0)
    assert(abs(distance.iloc[-1] - (soundings['Trail Distance'].iloc[-1] - soundings['Trail Distance'].iloc[0])) < 1e-9)
    time_of_day = SiteModel.map_variable_values(soundings=soundings, column='Time of day')
    first_time = soundings['Datetime'].iloc[0]
    assert(abs(time_of_day.iloc[0] - (first_time.hour * 3600 + first_time.minute * 60 + first_time.second + first_time.microsecond / 1e6)) < 1e-6)


def test_location_metadata():
    """
    Checks that a location given in a per-file JSON reaches the metadata of that line only.
    """
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    index = SiteModel.execute()
    locations = {}
    for line in index['lines']:
        locations[line['line']] = line['metadata'].get('location')
    assert(locations['L0002'] == 'Test pond')
    assert(locations['L0001'] is None)


def test_survey_beds():
    """
    The sample lines are short single passes, so by default (bed_max_distance 0) they get no bed at all. With a strip of
    bed_max_distance around the soundings, checks that the bed of each survey day is interpolated and written as the
    JSON file of the 3D view and as a CSV file with latitude, longitude, interpolated depth and distance to the nearest
    sounding.
    """
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    assert(SiteModel.bed_max_distance == 0)
    index = SiteModel.execute()
    assert(len(index['beds']) == 0)
    SiteModel.bed_max_distance = 4.0
    index = SiteModel.execute()
    # two survey days (the sample lines share a date, but L0002 has the location "Test pond") and the location
    # "Test pond", which was surveyed on that one day only, so it reuses that day's files
    assert(len(index['beds']) == 3)
    location_beds = [bed_record for bed_record in index['beds'] if bed_record['kind'] == 'location']
    assert(len(location_beds) == 1 and location_beds[0]['key'] == 'loc|Test pond')
    for bed_record in index['beds']:
        with open(os.path.join(SiteModel.output_directory, bed_record['files']['points'])) as f:
            bed = json.load(f)
        assert(len(bed['grid']['z']) == bed_record['points'])
        assert(len(bed['soundings']['z']) > 0)
        # all soundings of the survey day, in the same local coordinates as the grid
        survey_lines = [line for line in index['lines'] if line['id'] in bed_record['lines']]
        soundings = pd.concat([pd.read_csv(os.path.join(SiteModel.output_directory, line['files']['csv'])) for line in survey_lines])
        assert(len(soundings) == bed_record['soundings'])
        forward, backward, epsg = SiteModel.utm_transformer(soundings['Longitude'].mean(), soundings['Latitude'].mean())
        easting, northing = forward.transform(soundings['Longitude'].values, soundings['Latitude'].values)
        sounding_points = np.c_[easting - easting.mean(), northing - northing.mean()]
        grid_points = np.c_[bed['grid']['x'], bed['grid']['y']]
        nearest = np.sqrt(((grid_points[:, None, :] - sounding_points[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
        assert(np.abs(nearest - np.array(bed['grid']['d'])).max() <= 0.06)
        assert(nearest.max() <= SiteModel.bed_max_distance + 0.01)
        # the stored conversion from longitude and latitude to the metres of the bed matches the projection
        georef = bed['georef']
        local_x = georef['x'][0] + georef['x'][1] * soundings['Longitude'].values + georef['x'][2] * soundings['Latitude'].values
        local_y = georef['y'][0] + georef['y'][1] * soundings['Longitude'].values + georef['y'][2] * soundings['Latitude'].values
        assert(np.hypot(local_x - sounding_points[:, 0], local_y - sounding_points[:, 1]).max() < 0.05)
        # the outline of the surveyed area: triangles of soundings with no side longer than bed_max_gap
        outline = bed['outline']
        assert(len(outline['triangles']) % 3 == 0 and len(outline['triangles']) > 0)
        outline_points = np.c_[outline['x'], outline['y']][np.array(outline['triangles']).reshape(-1, 3)]
        sides = np.linalg.norm(outline_points - np.roll(outline_points, 1, axis=1), axis=2)
        assert(sides.max() <= SiteModel.bed_max_gap + 0.01)
        # linear interpolation never goes beyond the measured depths
        assert(min(bed['grid']['z']) >= soundings['Depth'].min() - 0.001)
        assert(max(bed['grid']['z']) <= soundings['Depth'].max() + 0.001)
        bed_csv = pd.read_csv(os.path.join(SiteModel.output_directory, bed_record['files']['csv']))
        assert(list(bed_csv.columns) == ['Latitude', 'Longitude', 'Interpolated depth', 'Distance to nearest sounding'])
        assert(len(bed_csv) == bed_record['points'])


def test_bed_fills_between_passes():
    """
    Checks the fill rule on a made-up survey: back-and-forth legs 15 m apart are filled in between, while nothing is
    filled around a line 90 m away (farther than bed_max_gap), and nothing beyond the outermost legs.
    """
    from pyproj import Transformer
    SiteModel = BathymetrySiteBuilder('tests/files/1_site_config.json')
    SiteModel.setup()
    SiteModel.bed_max_gap = 30.0
    track = []
    for leg in range(4):
        x_values = np.arange(0, 200, 1.0)
        if leg % 2 == 1:
            x_values = x_values[::-1]
        track += [(x_value, leg * 15.0) for x_value in x_values]
    track = np.array(track)
    isolated = np.c_[np.arange(0, 100, 1.0), np.full(100, 135.0)]
    to_degrees = Transformer.from_crs('EPSG:32617', 'EPSG:4326', always_xy=True)

    def soundings_frame(points, line_index):
        longitude, latitude = to_degrees.transform(700000 + points[:, 0], 4972000 + points[:, 1])
        return pd.DataFrame({'Latitude': latitude, 'Longitude': longitude, 'Depth': 2 + points[:, 0] / 100.0, 'Line index': line_index})
    soundings = pd.concat([soundings_frame(track, 0), soundings_frame(isolated, 1)], ignore_index=True)
    bed = SiteModel.interpolate_survey_bed(soundings)
    to_metres = Transformer.from_crs('EPSG:4326', 'EPSG:32617', always_xy=True)
    easting, northing = to_metres.transform(soundings['Longitude'].values, soundings['Latitude'].values)
    north = bed['y'] + bed['origin'][1] - 4972000
    east = bed['x'] + bed['origin'][0] - 700000
    # filled midway between the legs, where the nearest sounding is 7.5 m away
    between_legs = (north > 5) & (north < 10) & (east > 20) & (east < 180)
    assert(between_legs.sum() > 1000)
    assert(bed['distance'][between_legs].max() > 7)
    # nothing around the isolated line, nor between it and the survey
    assert((north > 50).sum() == 0)
    # nothing beyond the outermost legs
    assert(north.min() >= -1e-6 and east.min() >= -1e-6 and east.max() <= 199 + 1e-6)
    # linear interpolation stays within the measured depths
    assert(bed['z'].min() >= soundings['Depth'].min() - 1e-9 and bed['z'].max() <= soundings['Depth'].max() + 1e-9)
