const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

async function getMostRecentImageIdByName(name) {
  const ec2 = new AWS.EC2();

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#describeImages-property
  const params = {
    Filters: [
      {
        Name: 'name',
        Values: [name]
      }
    ],
    Owners: ['self']
  };

  try {
    const result = await ec2.describeImages(params).promise();
    if (!result.Images || result.Images.length === 0) {
      throw new Error('Image not found')
    }
    const imageId = result.Images.sort((a,b) => new Date(b.CreationDate) - new Date(a.CreationDate))[0].ImageId;
    core.info(`Found AMI: ${imageId}`);
    return imageId;
  } catch (error) {
    core.error('Unable to find an AMI with given name');
    throw error;
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  // User data scripts are run as the root user.
  // Docker and git are necessary for GitHub runner and should be pre-installed on the AMI.
  const userData = [
    '#!/bin/bash',
    `su -c "cd /opt/actions-runner; ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}; ./run.sh" -l "ubuntu"`,
  ];

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#runInstances-property
  const params = {
    ImageId: config.input.ec2ImageId || await getMostRecentImageIdByName(config.input.ec2ImageName),
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    InstanceMarketOptions: { MarketType: 'spot' },
  };

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} init error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
