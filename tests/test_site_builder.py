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
