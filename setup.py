from setuptools import setup, find_packages

with open('README.md') as f:
    long_description = f.read()

setup(
    name='BathyMap',
    version='0.1.0',
    long_description=long_description,
    long_description_content_type="text/markdown",
    description='Builds a static GitHub Pages website that maps and shares raw bathymetry survey data.',
    author='Mohammed Basheer',
    author_email='mohammedadamabbaker@gmail.com',
    license='GNU',
    install_requires=['click', 'pandas', 'numpy'],
    packages=find_packages(exclude=['tests']),
    entry_points={
        'console_scripts': ['BathyMap=BathyMap.cli:start_cli'],
    },
)
