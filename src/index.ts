import { readFile, readdirSync, statSync, writeFile } from 'fs'
import { join } from 'path'
import { init } from 'license-checker';
import { exit } from 'process';

export enum ArgsEnum {
  a = 'allowOnly',
  t = 'target',
  e = 'excluded'
}

export type CliArguments = Record<ArgsEnum, string>

export const argDefaults: CliArguments = {
  allowOnly: '',
  target: '',
  excluded: ''
}

export const argDescriptions: CliArguments = {
  allowOnly: 'text file with list of whitelisted licenses',
  target: 'output filename for json',
  excluded: 'packages to exclude'
}

const getAllPackageDirs = (dirPath, arrayOfFiles = []) => {
  readdirSync(dirPath).forEach((file) => {
    let isDirectory = false;
    try {
      isDirectory = statSync(dirPath + "/" + file).isDirectory()
    } catch (e) {
      return arrayOfFiles
    }
    if (file !== 'node_modules' && isDirectory) {
      arrayOfFiles = getAllPackageDirs(dirPath + "/" + file, arrayOfFiles)
    } else if (file === 'package.json') {
      arrayOfFiles.push(dirPath)
    }
  })

  return arrayOfFiles
}


const loadFile = (path) => new Promise<string>((resolve, reject) => {
  readFile(path, 'utf8', (err, data) => {
    if (err) {
      return reject(err)
    }
    resolve(data)
  })
})

const parseErrors = (packages, whiteListRegex = [], excluded = []) => Object.entries(packages).reduce((withErrors, [packageWithVersion, { licenses }]: [string, any]) => {
  const packageName = packageWithVersion.split('@').reverse()[1]
  if (!excluded.includes(packageName) && whiteListRegex.every(regex => !regex.test(licenses))) {
    withErrors.push(`(${packageWithVersion}) Invalid License: ${licenses}`)
  }
  return withErrors
}, [])


export async function recursivelyCheckLicenses(cliArguments: CliArguments): Promise<{ message: string }> {
  const root = process.cwd()
  const whiteList = cliArguments.allowOnly ? JSON.parse(await loadFile(join(root, cliArguments.allowOnly))) : []
  const excluded = cliArguments.excluded ? JSON.parse(await loadFile(join(root, cliArguments.excluded))) : []
  const out = join(root, cliArguments.target || 'package-license.json')
  const whiteListRegEx = whiteList.map(license => new RegExp(license, 'i'))

  const packageDirs = getAllPackageDirs(root)

  const results = await packageDirs.reduce(async (_combined, start) => new Promise(async (resolve) => {
    const combined = await _combined;

    init({ start }, (err, packages) => {
      const packageErrors = whiteList.length && parseErrors(packages, whiteListRegEx, excluded)
      if (err) {
        console.error(`Some error occurred while processing ${start}`)
        console.error(err)
        exit(1)
      } else if (packageErrors.length) {
        packageErrors.forEach(error => console.error(error))
        exit(1)
      } else {
        combined[join(start.replace(root, ''), '/')] = packages
        resolve(combined)
      }
    })

  }), Promise.resolve({}));

  await new Promise<void>((resolve) => {
    writeFile(out, JSON.stringify(results, null, 4), (err) => {
      if (err) {
        console.error(`some error when writing to ${out}`)
        exit(1)
      }
      resolve()
    })
  })

  return { message: `Saved license info to ${out}` }
}
